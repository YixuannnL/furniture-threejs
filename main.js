// 引入 Three.js 与 OrbitControls
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as Utils from './utils.js';

import jsonData from './output_2.json' assert { type: 'json' };
import ConnData from './Table_1.json' assert { type: 'json' };

const furnitureData = jsonData;
const connectionData = ConnData;

let editingConnections = new Map();

// ============== 创建一个十字叉辅助对象 ==============
function createCrossMarker(size = 20, color = 0xff0000) {
    const group = new THREE.Group();

    const material = new THREE.LineBasicMaterial({ color });
    // 水平线段
    const geoH = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-size, 0, 0),
        new THREE.Vector3(+size, 0, 0),
    ]);
    const lineH = new THREE.Line(geoH, material);
    group.add(lineH);

    // 垂直线段
    const geoV = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -size, 0),
        new THREE.Vector3(0, +size, 0),
    ]);
    const lineV = new THREE.Line(geoV, material);
    group.add(lineV);
    // 让它在渲染时排在最后
    group.renderOrder = 9999;
    return group;
}

// ============== highlightMesh: 让mesh始终显示在最前 + 边缘高亮 ==============
function highlightMesh(mesh) {
    mesh.renderOrder = 9998;
    if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => {
            m.depthTest = false;
        });
    } else {
        mesh.material.depthTest = false;
    }

    const edgesGeo = new THREE.EdgesGeometry(mesh.geometry);
    const edgesMat = new THREE.LineBasicMaterial({
        color: 0xffff00,
        linewidth: 5,
        depthTest: false
    });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    edges.renderOrder = 9999;
    mesh.add(edges);
    return edges;
}

// ============== clearSelectedMesh: 取消之前选中的高亮效果 ==============
function clearSelectedMesh() {
    if (selectedMesh) {
        // 恢复 depthTest
        if (Array.isArray(selectedMesh.material)) {
            selectedMesh.material.forEach(m => {
                m.depthTest = true;
            });
        } else {
            selectedMesh.material.depthTest = true;
        }
        selectedMesh.renderOrder = 0;

        if (selectedEdges && selectedEdges.parent) {
            selectedEdges.parent.remove(selectedEdges);
            selectedEdges.geometry.dispose();
        }
    }
    selectedMesh = null;
    selectedEdges = null;
}

// ============== selectMesh: 高亮新的 Mesh，取消之前的 ==============
function selectMesh(mesh) {
    clearSelectedMesh();
    selectedMesh = mesh;
    selectedEdges = highlightMesh(mesh);

    // 如果当前模式是 'connect'，则在Connections面板里把相关连接排到最前
    if (currentMode === 'connect' && mesh && mesh.name) {
        renderConnectionLog(mesh.name);
    }
}

// 用来存储“当前家具根对象”
let currentFurnitureRoot = null;
// 用来存储 "名称->Object3D" 映射（每次 render 时重新生成）
let objectsByName = {};

// 创建网格（Mesh）的辅助函数
function createMesh(objectType, dimensions) {
    const { width, height, depth } = dimensions; // 直接用毫米数值

    const geometry = new THREE.BoxGeometry(width, height, depth);

    // 随机“彩虹”效果材质
    const material = new THREE.MeshNormalMaterial({
        transparent: true,
        opacity: 0.8
    });

    // 创建网格（Mesh）
    const mesh = new THREE.Mesh(geometry, material);

    return mesh;
}

// 递归解析 JSON，生成 Three.js 对象
function parseMeta(meta) {
    let currentObject;

    // 如果是 group，就用 Group；否则就用 Mesh
    if (meta.object_type === 'group') {
        currentObject = new THREE.Group();
    } else {
        currentObject = createMesh(meta.object_type, meta.dimensions);
    }

    if (meta.object) {
        currentObject.name = meta.object;
        objectsByName[meta.object] = currentObject;
    }

    // 如果有子节点，则递归解析
    if (meta.children && Array.isArray(meta.children)) {
        meta.children.forEach(child => {
            const childObj = parseMeta(child.meta);
            currentObject.add(childObj);
        });
    }


    return currentObject;
}

// --------------------------------------------------------------------------------------------
// 解析 “<名称><类型>[<锚点A><锚点B>...]” 格式的字符串，并返回 { name, type, anchors:[] }
//    比如: "<Seat><Board>[<BottomFace><FrontLeftCorner>]" -> 
//          { name:"Seat", type:"Board", anchors:["BottomFace","FrontLeftCorner"] }
// --------------------------------------------------------------------------------------------
function parseConnectionString(str) {
    // 因为示例里有的用 "<...>"，有的用 "`<...>`"，我们先把反引号去掉，以便统一处理
    let cleanStr = str.replace(/`/g, '');
    // 典型格式可能是："<Seat><Board>[<BottomFace><FrontLeftCorner>]"
    // 先用正则取出 <> 里面的东西，再取 [] 里的东西
    // 简单做法：分两步。
    const patternAngle = /<([^<>]+)>/g;    // 匹配 <...> 之间内容
    const patternBracket = /\[([^(\]]+)\]/; // 匹配 [ ... ] 之间内容
    // 1) 提取所有 <...> 部分
    const angleMatches = cleanStr.match(patternAngle) || [];
    //  angleMatches 可能是 ["<Seat>", "<Board>", "<BottomFace>", "<FrontLeftCorner>"]
    //  但注意 <BottomFace><FrontLeftCorner> 实际是放在方括号里面
    //  我们约定：第一个 <...> 是 name，第二个 <...> 是 type，后面的在方括号里才是 anchors
    let name = '';
    let type = '';
    let anchors = [];

    if (angleMatches.length >= 2) {
        // 去掉左右括号
        name = angleMatches[0].replace(/[<>]/g, '');
        type = angleMatches[1].replace(/[<>]/g, '');
    }

    // 2) 提取 [ ... ] 里边的 `<xxx><yyy>` 这种
    const bracketMatch = cleanStr.match(patternBracket);
    //    bracketMatch 形如 [ "<BottomFace><FrontLeftCorner>", "BottomFace><FrontLeftCorner" ]
    if (bracketMatch && bracketMatch.length >= 2) {
        const inside = bracketMatch[1]; // "BottomFace><FrontLeftCorner"
        // 按照 >< 再拆分
        anchors = inside.split('><').map(item => item.replace(/[<>]/g, ''));
        // anchors = ["BottomFace","FrontLeftCorner"]
    }

    return { name, type, anchors };
}

// --------------------------------------------------------------------------------------------
//  根据 anchors 列表，计算该物体在局部坐标的“锚点位置” (x, y, z)
// --------------------------------------------------------------------------------------------
function calcLocalAnchorPosition(object3D, anchors) {
    // 首先要知道这个物体的宽高深。因为我们之前用 BoxGeometry(width, height, depth) + 中心在(0,0,0)。
    // 我们可以从 geometry.parameters 里拿到实际尺寸
    // 但需要确保 object3D 真的是 Mesh，且 geometry 是 BoxGeometry
    // 如果 object3D 是 Group，就可能没有 geometry，要看具体需求怎么处理
    const mesh = (object3D.isMesh) ? object3D : null;
    if (!mesh || !mesh.geometry || !mesh.geometry.parameters) {
        // 如果不是 Mesh 或不满足我们预期，就返回(0,0,0)或抛错
        return new THREE.Vector3(0, 0, 0);
    }

    const { width, height, depth } = mesh.geometry.parameters;
    const objType = Utils.getObjectType({ width, height, depth });

    // const Center = getCenterPoint(mesh);
    // let x = Center.x, y = Center.y, z = Center.z;
    let x = 0, y = 0, z = 0; //local坐标？

    // 定义一个辅助函数，用于把字符串如 "1/3" => 0.3333
    function fractionToFloat(fracStr) {
        // fracStr 形如 "1/2"、"2/3"、"1/4"...
        const parts = fracStr.split('/');
        if (parts.length === 2) {
            const numerator = parseFloat(parts[0]);
            const denominator = parseFloat(parts[1]);
            if (denominator !== 0) {
                return numerator / denominator;
            }
        }
        return 0; // 如果解析失败，返回0
    }
    console.log("anchor", anchors)
    // 遍历 anchors
    anchors.forEach(anchor => {
        // 判断一些关键标签
        switch (anchor) {
            case 'BottomFace':
                y = -height / 2;
                break;
            case 'TopFace':
                y = +height / 2;
                break;
            case 'FrontLeftCorner':
                x = -width / 2;
                z = +depth / 2;
                break;
            case 'FrontRightCorner':
                x = +width / 2;
                z = +depth / 2;
                break;
            case 'BackLeftCorner':
                x = -width / 2;
                z = -depth / 2;
                break;
            case 'BackRightCorner':
                x = +width / 2;
                z = -depth / 2;
                break;
            case 'TopEgde':
            case 'TopEdgeCenter':
                y = +height / 2;
                x = 0;
                z = 0;
                break;
            case 'BottomEdge':
            case 'BottomEdgeCenter':
                y = -height / 2;
                x = 0;
                z = 0;
                break;
            case 'LeftEdge':
            case 'LeftEdgeCenter':
                x = -width / 2;
                y = 0;
                z = 0;
                break;
            case 'RightEdge':
            case 'RightEdgeCenter':
                x = +width / 2;
                y = 0;
                z = 0;
                break;
            case 'FrontEdge':
            case 'FrontEdgeCenter':
                z = +depth / 2;
                y = 0;
                z = 0;
                break;
            case 'BackEdge':
            case 'BackEdgeCenter':
                z = -depth / 2;
                y = 0;
                z = 0;
                break;
            case 'TopEnd': y = +height / 2; x = 0; z = 0; break;
            case 'BottomEnd': y = -height / 2; x = 0; z = 0; break;
            case 'LeftEnd': x = -width / 2; y = 0; z = 0; break;
            case 'RightEnd': x = +width / 2; y = 0; z = 0; break;
            case 'FrontEnd': z = +depth / 2; y = 0; x = 0; break;
            case 'BackEnd': z = -depth / 2; y = 0; x = 0; break;

            case 'TopEndQuarter': y = +height / 2 - height * 0.25

            // 可以继续扩展更多标签
            default:
                // 如果像 "FrontFace_Height_1/3" / "TopFace_Width_1/2" / "LeftFaceFrontHalf" / ...
                // 先拆成 tokens
                const parts = anchor.split('_')

                const result = parts.map(part => {
                    // 用正则分离以分数开头的部分，例如 1/4Height => ["1/4", "Height"]
                    const match = part.match(/^(\d+\/\d+)([A-Za-z]+)$/);
                    if (match) {
                        return [match[1], match[2]];
                    }
                    return part; // 如果不是分数+文本，就原样返回
                });
                console.log("result:", result)
                switch (result[0]) {
                    case 'FrontFace': z = +depth / 2; break;
                    case 'BackFace': z = -depth / 2; break;
                    case 'LeftFace': x = -width / 2; break;
                    case 'RightFace': x = +width / 2; break;
                    case 'TopFace': y = +height / 2; break;
                    case 'BottomFace': y = -height / 2; break;
                    default: break;
                }
                for (let i = 1; i < result.length; i++) {
                    const item = result[i]
                    const fval = fractionToFloat(item[0]);
                    switch (item[1]) {
                        case 'Height': y = -height / 2 + fval * height; break;
                        case 'Width': x = -width / 2 + fval * width; break;
                        case 'Depth': z = -depth / 2 + fval * depth; break;
                    }
                }

                break;
        }
    });

    return new THREE.Vector3(x, y, z);
}

// 根据坐标得到Anchor名字
function getAnchorDescription(mesh, localPos) {
    const geom = mesh.geometry;
    if (!geom || !geom.parameters) {
        // 若不是 BoxGeometry，则返回一个默认值
        return '<UnknownFace>';
    }

    const { width, height, depth } = geom.parameters;
    const objType = Utils.getObjectType({ width, height, depth });

    if (objType === 'bar') {
        const { axisName, axisSize, end1Name, end2Name, end1Coord, end2Coord }
            = Utils.findBarAxisAndEnds(mesh);

        // 用一个 eps(阈值) 来判断“足够近”，表示用户点击在端面
        const eps = axisSize * 0.1;
        const dist1 = localPos.distanceTo(end1Coord);
        const dist2 = localPos.distanceTo(end2Coord);
        console.log("type:", objType);
        if (Math.abs(dist1) < eps) {
            // 靠近 end1 => 返回 <LeftEnd> / <BottomEnd> / <FrontEnd>...
            return `<${end1Name}>`;
        }
        else if (Math.abs(dist2) < eps) {
            // 靠近 end2
            return `<${end2Name}>`;
        }
        else {
            // 两端都不近 => 可能是中段
            // 你可以返回 <MidEnd> 或者再做更多判断(比如 partial quarter?)
            return Utils.getFaceFractionAnchor(localPos, width, height, depth);
        }
    }
}

// --------------------------------------------------------------------------------------------
// 真正处理连接：让 ObjA 的某个 anchor 对齐到 ObjB 的某个 anchor
//    同时确保它们在同一个 connectionGroup 里
// --------------------------------------------------------------------------------------------
function applyConnections(connectionData) {

    const list = connectionData.data;
    if (!list || !Array.isArray(list)) return;

    // 用于记录：每个Object3D的“所属连接组”
    // 这样如果A和B已经在同一个组，就不再移动
    const groupMap = new Map();
    function getGroup(obj) {
        let g = groupMap.get(obj);
        if (!g) {
            g = new Set();
            g.add(obj);
            groupMap.set(obj, g);
        }
        return g;
    }
    function unifyGroups(gA, gB) {
        if (gA === gB) return;
        for (let item of gB) {
            gA.add(item);
            groupMap.set(item, gA);
        }
    }

    list.forEach(item => {

        const seatStr = item['Seat'];
        const baseStr = item['Base'];
        if (!seatStr || !baseStr) return;

        const seatConn = parseConnectionString(seatStr);
        const baseConn = parseConnectionString(baseStr);

        const seatObj = objectsByName[seatConn.name];
        const baseObj = objectsByName[baseConn.name];
        if (!seatObj || !baseObj) {
            console.warn('找不到对象:', seatConn.name, baseConn.name);
            return;
        }

        // 计算它们的世界坐标 anchor
        // 先各自更新一次世界矩阵
        seatObj.updateMatrixWorld(true);
        baseObj.updateMatrixWorld(true);

        const seatLocalAnchor = calcLocalAnchorPosition(seatObj, seatConn.anchors);
        const seatWorldAnchor = seatObj.localToWorld(seatLocalAnchor.clone());

        const baseLocalAnchor = calcLocalAnchorPosition(baseObj, baseConn.anchors);
        const baseWorldAnchor = baseObj.localToWorld(baseLocalAnchor.clone());

        // 让 seatObj 的锚点贴到 baseObj 的锚点位置
        // 最简单的做法：seatObj.position += (baseWorldAnchor - seatWorldAnchor)
        // 这里假设 seatObj.parent == scene，如果父级层次更深，需要考虑 parent 的局部坐标
        const offset = new THREE.Vector3().subVectors(seatWorldAnchor, baseWorldAnchor);

        // 如果 seatObj 和 baseObj 不在同一组，移动 baseObj那一组
        const gA = getGroup(seatObj);
        const gB = getGroup(baseObj);
        if (gA !== gB) {
            // 移动 group B 的所有对象
            for (let obj of gB) {
                obj.position.add(offset);
            }
            unifyGroups(gA, gB);
        }
        // 如果已经在同一个组，就什么都不做（说明可能之前已经对齐过）
    });
}

// ======================
//      整体渲染函数 (核心！)
//      1) 清理旧的家具对象
//      2) 解析新的 meta
//      3) 应用 connData 对象对齐
//      4) 返回新的家具根对象
// ======================
function render_furniture(meta_data, conn_data) {
    // 1) 如果已有旧的家具根对象，就先从场景移除
    if (currentFurnitureRoot) {
        scene.remove(currentFurnitureRoot);
        currentFurnitureRoot = null;
    }

    // 2) 清空 "objectsByName" 映射
    objectsByName = {};

    // 3) 递归生成新的家具Object3D层次
    const furniture_object = parseMeta(meta_data.meta);

    // 4) 加到场景
    scene.add(furniture_object);
    currentFurnitureRoot = furniture_object;

    // 5) 应用连接
    applyConnections(conn_data);

    renderConnectionLog();

    return furniture_object;
}

// ===========================
// Three.js 初始化
// ===========================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(
    75, // 视野(FOV)
    window.innerWidth / window.innerHeight, // 宽高比
    0.1, // 近裁剪面
    100000 // 远裁剪面
);
camera.position.set(0, 800, 1500);
camera.lookAt(0, 0, 0);

const crossMarker = createCrossMarker(20, 0xff0000);
scene.add(crossMarker);
// 初始隐藏
crossMarker.visible = false;

const axesHelper = new THREE.AxesHelper(500);
scene.add(axesHelper);
const dir_x = new THREE.Vector3(1, 0, 0);
const dir_y = new THREE.Vector3(0, 0, 1);
const dir_z = new THREE.Vector3(0, 1, 0);
//normalize the direction vector (convert to vector of length 1)
dir_x.normalize();
dir_y.normalize();
dir_z.normalize();
const origin = new THREE.Vector3(0, 0, 0);
const length = 1500;
const hex_x = 0xffff00;
const hex_y = 0x00ffff;
const hex_z = 0xff00ff;
const arrowHelper_x = new THREE.ArrowHelper(dir_x, origin, length, hex_x);
const arrowHelper_y = new THREE.ArrowHelper(dir_y, origin, length, hex_y);
const arrowHelper_z = new THREE.ArrowHelper(dir_z, origin, length, hex_z);
scene.add(arrowHelper_x);
scene.add(arrowHelper_y);
scene.add(arrowHelper_z);

// 创建渲染器并添加到页面
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 加一个简单的环境光
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
// 加一个方向光
const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(0, 1000, 1000);
scene.add(dirLight);

// 方便鼠标交互旋转、缩放
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.update();

// ======================
// 一开始就渲染一遍(初始状态)
// ======================
render_furniture(furnitureData, connectionData);

// ======================
// 以下是交互逻辑：用户交互如何“更新 data”，再“重新渲染”
//   （1）连接模式：点A点B => 在 connectionData.data.push(...)
//   （2）修改尺寸：在 furnitureData.meta.children[...] 里更新 => 再 render_furniture
// ======================

let currentMode = 'connect'; // 'connect' or 'stretch'
const infoDiv = document.getElementById('info');

// 声明一个 Raycaster
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let selectedMesh = null;     // 当前选中的 mesh（高亮+前置）
let selectedEdges = null;    // 用于边缘高亮的 lineSegments

const SNAP_STEP = 50; // 以 50mm 为吸附步长

// =========== 连接模式状态机 =============
let connectState = 0;     // 0:无, 1:选了物体A, 2:选了物体A的Anchor, 3:选了物体B, 4:选了物体B的Anchor(=完成)
let firstMesh = null;     // 第一个物体
let firstAnchor = new THREE.Vector3(); // 第一个锚点(世界坐标)
let secondMesh = null;    // 第二个物体
let secondAnchor = new THREE.Vector3(); // 第二个锚点(世界坐标)


// -- 用于“拉伸模式”时，选中的对象 / faceIndex / 初始点击点 --
let pickedMeshForStretch = null;
let pickedFaceIndex = -1;
let pickedFaceAxis = null; // "width"|"height"|"depth"

// 对应 HTML 面板元素
const stretchPanel = document.getElementById('stretchPanel');
const stretchObjectNameSpan = document.getElementById('stretchObjectName');
const stretchFaceAxisSpan = document.getElementById('stretchFaceAxis');
const stretchCurrentSizeSpan = document.getElementById('stretchCurrentSize');
const stretchSizeInput = document.getElementById('stretchSizeInput');
const applyStretchBtn = document.getElementById('applyStretchBtn');

let mouseDown = false;
let lastMousePos = { x: 0, y: 0 }; // 记录拖动前坐标

// ============ 工具函数：更新 metaData 里的某个对象的尺寸 ============
function updateDimensionInMeta(rootMeta, targetName, axis, newVal) {
    // 递归在 meta 里找 object==targetName
    function recurse(meta) {
        if (meta.object === targetName) {
            if (meta.dimensions && meta.dimensions[axis] !== undefined) {
                meta.dimensions[axis] = newVal;
            }
        }
        if (Array.isArray(meta.children)) {
            for (let c of meta.children) {
                recurse(c.meta);
            }
        }
    }
    recurse(rootMeta);
}

// =============================
// 当用户点击某个面时，显示面板并填入数据
// =============================
function showStretchPanel(mesh, faceIndex) {
    if (!mesh.geometry || !mesh.geometry.parameters) return;

    const { width, height, depth } = mesh.geometry.parameters;
    const { axis, sign } = Utils.getFaceAxisByIndex(faceIndex);

    // 如果找不到轴，就不显示面板
    if (!axis) {
        stretchPanel.style.display = 'none';
        return;
    }

    // 记录
    pickedMeshForStretch = mesh;
    pickedFaceIndex = faceIndex;
    pickedFaceAxis = axis;

    // 根据 axis，取当前尺寸
    let currentVal = 0;
    if (axis === 'width') currentVal = width;
    if (axis === 'height') currentVal = height;
    if (axis === 'depth') currentVal = depth;

    // 更新面板UI
    stretchObjectNameSpan.innerText = mesh.name || '(unnamed)';
    stretchFaceAxisSpan.innerText = axis.toUpperCase();
    stretchCurrentSizeSpan.innerText = currentVal.toFixed(1);
    stretchSizeInput.value = currentVal.toFixed(1);

    // 显示面板
    stretchPanel.style.display = 'block';
}

// =============================
// 用户点击 "Apply" 按钮时，更新几何
// =============================
applyStretchBtn.addEventListener('click', () => {
    if (!pickedMeshForStretch || !pickedFaceAxis) return;

    // 从输入框取新的尺寸
    const newVal = parseFloat(stretchSizeInput.value);
    if (isNaN(newVal) || newVal <= 0) {
        alert('Invalid number');
        return;
    }
    // 在 metaData 里找这个mesh对应的 objectName，更新其 axis
    updateDimensionInMeta(furnitureData.meta, pickedMeshForStretch.name, pickedFaceAxis, newVal);
    // 然后重新渲染
    render_furniture(furnitureData, connectionData);
    alert('Dimension updated and re-rendered!');
});


// 更新显示文字
function updateInfo() {
    // 先声明一个文本变量，用来累积要显示的内容
    let text = `
        <div> Mode:${currentMode}</div>
        `;

    if (currentMode === 'connect') {
        // 如果还没选择第一个对象
        if (connectState === 0) {
            text += `<div>Please pick the first object.</div>`
        }
        else if (connectState === 1) {
            text += `<div>Now you choose the first object: ${firstMesh.name}, please click an anchor on it.</div>`
        }
        else if (connectState === 2) {
            text += `<div>Now you choose the first object: ${firstMesh.name}.</div>`
            text += `<div>The Anchor you choose is (${firstAnchor.toArray().join()})</div>`
            text += `<div>Please pick the second object.</div>`
        }
        else if (connectState === 3) {
            text += `<div>Now you choose the first object: ${firstMesh.name}.</div>`
            text += `<div>The Anchor you choose is (${firstAnchor.toArray().join()})</div>`
            text += `<div>Now you choose the second object: ${secondMesh.name}, please click an anchor on it.</div>`
        }
        else {
            text += `<div>Now you choose the first object: ${firstMesh.name}.</div>`
            text += `<div>The Anchor you choose is (${firstAnchor.toArray().join()})</div>`
            text += `<div>Now you choose the second object: ${secondMesh.name}.</div>`
            text += `<div>The Anchor you choose is (${secondAnchor.toArray().join()}).</div>`
        }

    }
    else {
        // 拉伸模式提示
        text += 'Click on a face to see/edit dimension.';
    }

    infoDiv.innerHTML = text;
}

document.getElementById('connectModeBtn').addEventListener('click', () => {
    currentMode = 'connect';
    clearSelectedMesh();
    updateInfo();
});
document.getElementById('stretchModeBtn').addEventListener('click', () => {
    currentMode = 'stretch';
    clearSelectedMesh();
    updateInfo();
});

function escapeHtml(str) {
    return str
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
/**
 * 判断某个连接 item 是否包含指定的 meshName
 * item 形如 { "Seat": "<Seat>...", "Base": "<Leg_Front_Left>..." }
 */
function connectionItemHasName(connItem, meshName) {
    // 只要 Seat/Base 的字符串里解析到 name == meshName 就算匹配
    const seatConn = parseConnectionString(connItem['Seat'] || '');
    const baseConn = parseConnectionString(connItem['Base'] || '');
    return (seatConn.name === meshName) || (baseConn.name === meshName);
}
// ===============================
//  渲染“Connections”面板
//  selectedMeshName：可选参数；若有，会将相关连接排在最前
// ===============================
function renderConnectionLog(selectedMeshName = null) {
    const container = document.getElementById('connectionLog');
    // 先把容器里的东西都清空（保留最初那行“<strong>Connections:</strong>”）
    // 为了保留最前头的 <div><strong>Connections:</strong></div>，我们可以先只移除它之后的所有子节点
    while (container.children.length > 1) {
        container.removeChild(container.lastChild);
    }

    // 复制一份连接数组
    let conns = [...connectionData.data];

    // 如果指定了 selectedMeshName，就排序，让相关连接排前面
    if (selectedMeshName) {
        conns.sort((a, b) => {
            const aHas = connectionItemHasName(a, selectedMeshName);
            const bHas = connectionItemHasName(b, selectedMeshName);
            // bHas - aHas 能让 true(1) 的排在前面
            return (bHas - aHas);
        });
    }

    // 逐条渲染
    conns.forEach((item) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'conn-item';

        // 若此连接在编辑模式
        if (editingConnections.has(item)) {
            renderConnectionItem_EditMode(itemDiv, item);
        } else {
            renderConnectionItem_NormalMode(itemDiv, item);
        }

        container.appendChild(itemDiv);
    });
}

/**
 * 正常模式下(未编辑)
 * 显示文本 + [Remove] [Edit] 按钮
 */
function renderConnectionItem_NormalMode(parentDiv, item) {
    const seatStr = item['Seat'] || '';
    const baseStr = item['Base'] || '';

    const textBlock = document.createElement('div');
    textBlock.innerHTML = `
        FirstMesh => ${escapeHtml(seatStr)} <br>
        SecondMesh => ${escapeHtml(baseStr)}
    `;
    parentDiv.appendChild(textBlock);

    // Remove 按钮
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
        removeConnection(item);
    });
    parentDiv.appendChild(removeBtn);

    // Edit 按钮
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
        startEditingConnection(item);
    });
    parentDiv.appendChild(editBtn);
}

/**
 * 编辑模式下
 * 显示两个输入框 + [Cancel] [Save] 按钮
 */
function renderConnectionItem_EditMode(parentDiv, item) {
    // 从 editingConnections 里取出临时数据
    const editingData = editingConnections.get(item);
    // editingData = { seatStr, baseStr }

    // 创建输入框
    const seatInput = document.createElement('input');
    seatInput.type = 'text';
    seatInput.style.width = '90%';
    seatInput.value = editingData.seatStr;
    parentDiv.appendChild(document.createTextNode('Seat => '));
    parentDiv.appendChild(seatInput);
    parentDiv.appendChild(document.createElement('br'));

    const baseInput = document.createElement('input');
    baseInput.type = 'text';
    baseInput.style.width = '90%';
    baseInput.value = editingData.baseStr;
    parentDiv.appendChild(document.createTextNode('Base => '));
    parentDiv.appendChild(baseInput);
    parentDiv.appendChild(document.createElement('br'));

    // Cancel 按钮
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
        cancelEditingConnection(item);
    });
    parentDiv.appendChild(cancelBtn);

    // Save 按钮
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
        saveEditingConnection(item, seatInput.value, baseInput.value);
    });
    parentDiv.appendChild(saveBtn);
}

/**
 * 进入编辑模式
 * 在 editingConnections 中登记此条的 seat/base 原始值
 */
function startEditingConnection(item) {
    editingConnections.set(item, {
        seatStr: item.Seat || '',
        baseStr: item.Base || ''
    });
    // 重新渲染面板
    renderConnectionLog();
}

/**
 * 取消编辑模式
 */
function cancelEditingConnection(item) {
    editingConnections.delete(item);
    renderConnectionLog();
}

/**
 * 保存编辑
 * - seatStrNew / baseStrNew 是用户在输入框里改过的值
 */
function saveEditingConnection(item, seatStrNew, baseStrNew) {
    // 1) 校验 seatStrNew
    if (!validateConnectionStringFormat(seatStrNew)) {
        alert('Invalid Seat connection string format!');
        return;
    }

    // 2) 校验 baseStrNew
    if (!validateConnectionStringFormat(baseStrNew)) {
        alert('Invalid Base connection string format!');
        return;
    }

    // 若都通过 => 更新 item
    item.Seat = seatStrNew;
    item.Base = baseStrNew;

    // 完成更新后，退出编辑模式
    editingConnections.delete(item);

    // 重新渲染场景和面板
    render_furniture(furnitureData, connectionData);
}

function validateConnectionStringFormat(str) {
    const conn = parseConnectionString(str);
    // 简单判断
    if (!conn.name || !conn.type || !Array.isArray(conn.anchors) || conn.anchors.length === 0) {
        return false;
    }
    return true;
}

// ===============================
//  从 connectionData.data 中移除一条连接
// ===============================
function removeConnection(item) {
    // 找到它的索引
    const idx = connectionData.data.indexOf(item);
    if (idx >= 0) {
        connectionData.data.splice(idx, 1);
    }

    // 移除后重新渲染家具 & 重新渲染连接列表
    render_furniture(furnitureData, connectionData);
    renderConnectionLog();
}

// 重置
function resetConnectProcess() {
    connectState = 0;
    firstMesh = null;
    secondMesh = null;
    clearSelectedMesh();
    updateInfo();
}

function onPointerMove(event) {
    // 如果不是“连接模式”，就隐藏十字叉，返回
    if (currentMode !== 'connect') {
        crossMarker.visible = false;
        return;
    }

    // 转换鼠标坐标到标准化设备坐标(-1 ~ +1)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
        const hit = intersects[0];
        const hitObject = hit.object;
        const hitPointWorld = hit.point.clone();

        // 将世界坐标转换到 mesh 的本地坐标
        let localPos = hitObject.worldToLocal(hitPointWorld.clone());

        // 吸附
        localPos.x = SNAP_STEP * Math.round(localPos.x / SNAP_STEP);
        localPos.y = SNAP_STEP * Math.round(localPos.y / SNAP_STEP);
        localPos.z = SNAP_STEP * Math.round(localPos.z / SNAP_STEP);

        // 转回世界坐标
        const snappedWorldPos = hitObject.localToWorld(localPos.clone());

        // 将十字叉标记移动到该位置，并显示
        crossMarker.position.copy(snappedWorldPos);
        crossMarker.visible = true;
    } else {
        // 没有命中任何对象，就隐藏
        crossMarker.visible = false;
    }
}

let firstAnchorStr = null
let firstMeshType = null

// ============ 事件监听(连接模式/拉伸模式) ============
function onPointerUp(event) {
    if (onDownTime + 300 < Date.now()) {
        return
    }
    console.log(currentMode)
    mouseDown = true;
    lastMousePos.x = event.clientX;
    lastMousePos.y = event.clientY;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (currentMode === 'connect') {
        // 根据 connectState 分情况
        if (connectState === 0) {
            // 尚未选第一个物体
            if (intersects.length > 0) {
                console.log("step1:", intersects)
                // 点击到了某个物体 => 选中作为第一个物体
                const hitObject = intersects[0].object;
                selectMesh(hitObject);
                firstMesh = hitObject;
                connectState = 1; // 等待选第一个锚点
            } else {
                // 点到空白 => 无事发生
            }
        }
        else if (connectState === 1) {
            console.log("step2:", intersects, intersects.length)
            // 已选中第一个物体, 等待在这个物体上选 anchor
            if (intersects.length > 0) {
                // const hitObject = intersects[0].object;
                // 如果点到别的物体 或 空白
                // if (hitObject !== firstMesh) {
                const hit = intersects.find(item => item.object == firstMesh)
                if (!hit) {
                    // 取消选中 & 重置
                    resetConnectProcess();
                } else {
                    // 点到 firstMesh => 这是 anchor
                    console.log("hit:", hit);
                    const hitPoint = hit.point.clone();
                    // 吸附
                    let localPos = firstMesh.worldToLocal(hitPoint);
                    localPos.x = SNAP_STEP * Math.round(localPos.x / SNAP_STEP);
                    localPos.y = SNAP_STEP * Math.round(localPos.y / SNAP_STEP);
                    localPos.z = SNAP_STEP * Math.round(localPos.z / SNAP_STEP);
                    firstAnchorStr = getAnchorDescription(firstMesh, localPos); //这个函数有问题
                    firstMeshType = Utils.getObjectType({ width: firstMesh.geometry.parameters.width, height: firstMesh.geometry.parameters.height, depth: firstMesh.geometry.parameters.depth })
                    firstAnchor.copy(firstMesh.localToWorld(localPos.clone()));

                    connectState = 2; // 等待选第二物体
                }
            } else {
                // 点到空白 => 取消
                resetConnectProcess();
            }
        }
        else if (connectState === 2) {
            console.log("step3:", intersects)
            // 已有 firstMesh + anchor, 等待选第二物体
            if (intersects.length > 0) {
                const hitObject = intersects[0].object;
                if (hitObject === firstMesh) {
                    resetConnectProcess();
                } else {
                    // 选中了第二个物体
                    clearSelectedMesh()
                    selectMesh(hitObject);
                    secondMesh = hitObject;
                    connectState = 3; // 等待在第二物体上选 anchor
                }
            } else {
                // 点空白 => 重置
                resetConnectProcess();
            }
        }
        else if (connectState === 3) {
            // 已选中第二物体, 等待 anchor
            console.log("step4:", intersects)
            if (intersects.length > 0) {
                // const hitObject = intersects[0].object;
                const hit = intersects.find(item => item.object == secondMesh)
                if (!hit) {
                    resetConnectProcess();
                } else {
                    // 点到 secondMesh => anchor
                    const hitPoint = hit.point.clone();
                    let localPos = secondMesh.worldToLocal(hitPoint);
                    localPos.x = SNAP_STEP * Math.round(localPos.x / SNAP_STEP);
                    localPos.y = SNAP_STEP * Math.round(localPos.y / SNAP_STEP);
                    localPos.z = SNAP_STEP * Math.round(localPos.z / SNAP_STEP);
                    let secondAnchorStr = getAnchorDescription(secondMesh, localPos);
                    let secondMeshType = Utils.getObjectType({ width: secondMesh.geometry.parameters.width, height: secondMesh.geometry.parameters.height, depth: secondMesh.geometry.parameters.depth })
                    secondAnchor.copy(secondMesh.localToWorld(localPos.clone()));

                    const firstConnStr = `<${firstMesh.name}><${firstMeshType}>[${firstAnchorStr}]`
                    const secondConnStr = `<${secondMesh.name}><${secondMeshType}>[${secondAnchorStr}]`

                    console.log("AnchorStr:", firstConnStr, secondAnchorStr)
                    connectionData.data.push({
                        "Seat": firstConnStr,
                        "Base": secondConnStr
                    })

                    render_furniture(furnitureData, connectionData);

                    // 重置
                    connectState = 0;
                    firstMesh = null;
                    secondMesh = null
                    firstAnchorStr = null
                    firstMeshType = null

                    clearSelectedMesh()
                }
            } else {
                // 点到空白 => 回到 state2 or reset
                resetConnectProcess();
            }
        }
    }
    else if (currentMode === 'stretch') {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);

        if (intersects.length > 0) {
            const hit = intersects[0];
            const hitObject = hit.object;
            const faceIndex = hit.faceIndex;

            // 只有是 Mesh 且是 BoxGeometry 时才执行
            if (hitObject.isMesh && hitObject.geometry && hitObject.geometry.parameters) {
                showStretchPanel(hitObject, faceIndex);
            }
        }
    }


    updateInfo();
}

let onDownTime = 0;
// 事件监听
function onPointerDown() {
    onDownTime = Date.now()
}

window.addEventListener('mousedown', onPointerDown, false);
window.addEventListener('mousemove', onPointerMove, false);
window.addEventListener('mouseup', onPointerUp, false);

updateInfo();

// ******* 新增：以上是交互逻辑 ******* //

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', onWindowResize);
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
