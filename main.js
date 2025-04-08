// 引入 Three.js 与 OrbitControls
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as Utils from './utils.js';

// import jsonData from './output_2.json' assert { type: 'json' };
// import ConnData from './Table_1.json' assert { type: 'json' };
import jsonData from './input_data/meta_data.json' assert { type: 'json' };
import ConnData from './input_data/conn_data.json' assert { type: 'json' };

let furnitureData = jsonData;
let connectionData = ConnData;

let editingConnections = new Map();
let selectedMesh = null;     // 当前选中的 mesh（高亮+前置）
let selectedEdges = null;    // 用于边缘高亮的 lineSegments

// 用来存储“当前家具根对象”
let currentFurnitureRoot = null;
// 用来存储 "名称->Object3D" 映射（每次 render 时重新生成）
let objectsByName = {};

// 存储所有拉伸变更的日志记录
let dimensionChangeLog = [];

// ==================== 新增：处理家具树形结构的增删操作 ====================

// 生成树形面板, 传入初始层级 0
function renderTreePanel() {
    const treePanel = document.getElementById('treePanel');
    if (!treePanel) return;

    treePanel.innerHTML = '<h3>Furniture Hierarchy</h3>';
    const rootMeta = furnitureData.meta;
    const rootContainer = document.createElement('div');
    buildMetaNodeUI(rootMeta, rootContainer, null, 0); // 初始层级设为 0
    treePanel.appendChild(rootContainer);
}

/**
 * 递归构建某个 meta 节点的 UI
 * @param {Object} meta  - 当前节点的 meta
 * @param {HTMLElement} container - 容器DOM
 * @param {Object} parentMeta - 父节点meta，用于删除操作时找到自己在children中的位置
 * @param {number} level - 当前节点的层级（用于缩进）
 */
function buildMetaNodeUI(meta, container, parentMeta, level) {
    const indent = level * 20; // 每层缩进20px
    const row = document.createElement('div');
    row.style.marginLeft = indent + 'px';
    // 只有非根节点显示边框
    row.style.borderLeft = level > 0 ? '1px dashed #ccc' : 'none';
    row.style.paddingLeft = '8px';

    // 显示当前节点信息
    const titleSpan = document.createElement('span');
    const objName = meta.object || '(no-name)';
    const objType = meta.object_type || '(no-type)';
    titleSpan.textContent = `${objName} (${objType})`;
    titleSpan.style.fontWeight = 'bold';
    row.appendChild(titleSpan);

    // 如果不是根节点，可以显示「删除」按钮
    if (parentMeta) {
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.style.marginLeft = '8px';
        delBtn.addEventListener('click', () => {
            const yes = confirm(`Are you sure to delete ${objName}?`);
            if (!yes) return;
            removeChildMeta(parentMeta, meta);
        });
        row.appendChild(delBtn);
    }

    // 如果是 group 类型，就允许添加子节点
    if (meta.object_type === 'group') {
        const addBtn = document.createElement('button');
        addBtn.textContent = 'Add Child';
        addBtn.style.marginLeft = '4px';
        addBtn.addEventListener('click', () => {
            promptAddChild(meta);
        });
        row.appendChild(addBtn);
    }

    container.appendChild(row);

    // 如果有 children，递归生成子节点UI，层级加1
    if (meta.children && Array.isArray(meta.children)) {
        meta.children.forEach(child => {
            buildMetaNodeUI(child.meta, container, meta, level + 1);
        });
    }
}

/**
 * 删除操作：从 parentMeta.children 中移除指定 childMeta
 */
function removeChildMeta(parentMeta, childMeta) {
    if (!parentMeta.children) return;
    // 在 parentMeta.children 中找到 childMeta 对应的 index
    const idx = parentMeta.children.findIndex(c => c.meta === childMeta);
    if (idx >= 0) {
        parentMeta.children.splice(idx, 1);
        // 重新渲染
        render_furniture(furnitureData, connectionData);
        renderTreePanel();
    }
}

/**
 * 弹窗让用户输入新节点信息，然后插入到 parentMeta.children
 */
function promptAddChild(parentMeta) {
    const objName = prompt('New Object Name (e.g. "Back_Rest")');
    if (!objName) return; // 用户取消
    const objType = prompt('New Object Type (group / board / block / bar)');
    if (!objType) return;

    // 如果 objType != group，需要让用户输入尺寸
    // 如果 objType == group，可以给默认尺寸(或者也可以让用户输)
    let width = 0, height = 0, depth = 0;
    if (objType === 'group') {
        // 给一个默认体积(或者也可不写)
        width = 1000; height = 1000; depth = 1000;
    } else {
        // 让用户输入具体尺寸
        width = parseFloat(prompt('width (mm)', '500')) || 500;
        height = parseFloat(prompt('height (mm)', '100')) || 100;
        depth = parseFloat(prompt('depth (mm)', '300')) || 300;
    }

    // 构造一个新的 child
    const newChild = {
        "meta": {
            "object": objName,
            "object_type": objType,
            "dimensions": {
                "width": width,
                "height": height,
                "depth": depth
            }
            // children: [] // 一般不需要显式加, group时如果你想初始就有children可加
        }
    };

    // 如果 parentMeta 没有 children，就先创建
    if (!parentMeta.children) {
        parentMeta.children = [];
    }
    parentMeta.children.push(newChild);

    // 重新渲染
    render_furniture(furnitureData, connectionData);
    renderTreePanel();
}

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

    // 新增：恢复显示区域
    const displayDiv = document.getElementById('selectedMeshDisplay');
    if (displayDiv) {
        displayDiv.textContent = "No mesh selected";
    }
}

// ============== selectMesh: 高亮新的 Mesh，取消之前的 ==============
function selectMesh(mesh) {
    clearSelectedMesh();
    selectedMesh = mesh;
    selectedEdges = highlightMesh(mesh);

    // 如果当前模式是 'connect'，则在Connections面板里把相关连接排到最前
    if (currentMode === 'connect' && mesh && mesh.name) {
        renderConnectionLog();
    }

    const displayDiv = document.getElementById('selectedMeshDisplay');
    if (displayDiv && mesh.name) {
        displayDiv.textContent = `Selected Mesh: ${mesh.name}`;
    }
}

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
    // console.log("name:",)
    name = name.toLowerCase().replace(/ /g, '_');
    name = name.replace(/[^a-z0-9_]/g, '');
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
    // const objType = Utils.getObjectType({ width, height, depth });

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

    // 遍历 anchors
    anchors.forEach(anchor => {
        // 判断一些关键标签
        console.log("nowanchor:", anchor)
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
            case 'TopEdge':
            case 'TopEdgeCenter':
                y = +height / 2;
                x = 0;
                z = 0;
                console.log("y:", y);
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
                x = 0;
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
    // console.log("list", list);
    list.forEach(item => {
        // console.log("item:", item);
        const keys = Object.keys(item) // ['Seat','Base']
        const firstkey = keys[0]
        const secondkey = keys[1]
        const firstStr = item[firstkey];
        const secondStr = item[secondkey];
        if (!firstStr || !secondStr) return;
        if (firstStr === "" || secondStr === "") return;

        const firstConn = parseConnectionString(firstStr);
        const secondConn = parseConnectionString(secondStr);

        // console.log("firstConn", firstConn);
        // console.log("secondConn", secondConn);

        const firstObj = objectsByName[firstConn.name];
        const secondObj = objectsByName[secondConn.name];
        if (!firstObj || !secondObj) {
            console.warn('找不到对象:', firstConn.name, secondConn.name);
            return;
        }

        // 计算它们的世界坐标 anchor
        // 先各自更新一次世界矩阵
        firstObj.updateMatrixWorld(true);
        secondObj.updateMatrixWorld(true);

        const firstLocalAnchor = calcLocalAnchorPosition(firstObj, firstConn.anchors);
        const firstWorldAnchor = firstObj.localToWorld(firstLocalAnchor.clone());

        const secondLocalAnchor = calcLocalAnchorPosition(secondObj, secondConn.anchors);
        const secondWorldAnchor = secondObj.localToWorld(secondLocalAnchor.clone());
        console.log("anchor:", firstConn.anchors, "local:", firstLocalAnchor)
        // 让 firstObj 的锚点贴到 secondObj 的锚点位置
        // 最简单的做法：firstObj.position += (secondWorldAnchor - firstWorldAnchor)
        // 这里假设 firstObj.parent == scene，如果父级层次更深，需要考虑 parent 的局部坐标
        const offset = new THREE.Vector3().subVectors(firstWorldAnchor, secondWorldAnchor);

        // 如果 firstObj 和 secondObj 不在同一组，移动 secondObj那一组
        const gA = getGroup(firstObj);
        const gB = getGroup(secondObj);
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

    //遍历一遍所有的mesh，此处排开

    renderConnectionLog();

    renderTreePanel();

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
// 本地一开始就渲染一遍(初始状态) 线上环境等待外部传入json
// ======================
const isProd = import.meta.env.PROD
// const isProd = true
if (isProd) {
    window.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') {
            return;
        }
        try {
            const data = JSON.parse(event.data)
            if (data.event === 'init') {
                connectionData = JSON.parse(data.data.conn)
                furnitureData = JSON.parse(data.data.meta)
                render_furniture(furnitureData, connectionData);
            }
        } catch (err) {
            console.error('message', event, err)
        }
    })
    window.parent.postMessage(JSON.stringify({ event: 'ready' }), '*')
} else {
    render_furniture(furnitureData, connectionData);
}

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

const SNAP_STEP = 50; // 以 50mm 为吸附步长

// =========== 连接模式状态机 =============
let connectState = 0;     // 0:无, 1:选了物体A, 2:选了物体A的Anchor, 3:选了物体B, 4:选了物体B的Anchor(=完成)
let firstMesh = null;     // 第一个物体
let firstAnchor = new THREE.Vector3(); // 第一个锚点(世界坐标)
let secondMesh = null;    // 第二个物体
let secondAnchor = new THREE.Vector3(); // 第二个锚点(世界坐标)

// =========== 连接模式状态机 =============
// 0: 未选择A
// 1: 已选择A及其faceIndex => 等待选B面
let stretchState = 0;
let stretchMeshA = null;
let stretchMeshB = null;
let stretchFaceIndexA = -1;
let stretchFaceIndexB = -1;

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

// ============== 新增：更新 dimensions 与 offset 的辅助函数 ==============
function updateDimensionAndOffsetInMeta(rootMeta, targetName, axis, newVal) {
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
// function showStretchPanel(mesh, faceIndex) {
//     if (!mesh.geometry || !mesh.geometry.parameters) return;

//     const { width, height, depth } = mesh.geometry.parameters;
//     const { axis, sign } = Utils.getFaceAxisByIndex(faceIndex);

//     // 如果找不到轴，就不显示面板
//     if (!axis) {
//         stretchPanel.style.display = 'none';
//         return;
//     }

//     // 记录
//     pickedMeshForStretch = mesh;
//     pickedFaceIndex = faceIndex;
//     pickedFaceAxis = axis;

//     // 根据 axis，取当前尺寸
//     let currentVal = 0;
//     if (axis === 'width') currentVal = width;
//     if (axis === 'height') currentVal = height;
//     if (axis === 'depth') currentVal = depth;

//     // 更新面板UI
//     stretchObjectNameSpan.innerText = mesh.name || '(unnamed)';
//     stretchFaceAxisSpan.innerText = axis.toUpperCase();
//     stretchCurrentSizeSpan.innerText = currentVal.toFixed(1);
//     stretchSizeInput.value = currentVal.toFixed(1);

//     // 显示面板
//     stretchPanel.style.display = 'block';
// }

// =============================
// 用户点击 "Apply" 按钮时，更新几何
// =============================
// applyStretchBtn.addEventListener('click', () => {
//     if (!pickedMeshForStretch || !pickedFaceAxis) return;

//     // 从输入框取新的尺寸
//     const newVal = parseFloat(stretchSizeInput.value);
//     if (isNaN(newVal) || newVal <= 0) {
//         alert('Invalid number');
//         return;
//     }
//     // 在 metaData 里找这个mesh对应的 objectName，更新其 axis
//     updateDimensionInMeta(furnitureData.meta, pickedMeshForStretch.name, pickedFaceAxis, newVal);
//     // 然后重新渲染
//     render_furniture(furnitureData, connectionData);
//     alert('Dimension updated and re-rendered!');
// });


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
        // 拉伸模式
        if (stretchState === 0) {
            text += `<div> Please pick the object you want to stretch. </div>`;
        } else if (stretchState === 1) {
            text += `<div>Now you choose the object: ${stretchMeshA.name}. Please choose a face to  to stretch this object. </div>`;
        } else if (stretchState === 2) {
            text += `<div>Now you choose the object: ${stretchMeshA.name}.</div>`
            text += `<div>The Face you choose is (${stretchFaceIndexA})</div>`
            text += `<div>Please Choose the referece object.</div>`
        } else if (stretchState === 3) {
            text += `<div>Now you choose the object: ${stretchMeshA.name}.</div>`
            text += `<div>The Face you choose is (${stretchFaceIndexA})</div>`
            text += `<div>Please Choose the referece object ${stretchMeshB.name}, please choose a face on it.</div>`
        } else {
            text += `<div>Now you choose the object: ${stretchMeshA.name}.</div>`
            text += `<div>The Face you choose is (${stretchFaceIndexA})</div>`
            text += `<div>Please Choose the referece object ${stretchMeshB.name}, please choose a face on it.</div>`
            text += `<div>The Face you choose on reference object is (${stretchFaceIndexA})</div>`
        }
    }

    infoDiv.innerHTML = text;
}

function changeConnectState() {
    currentMode = 'connect';
    clearSelectedMesh();
    updateInfo();
    // 获取目标 div 元素（假设 div 的 id 是 "myDiv"）
    var divElement = document.getElementById("dimensionChanges");
    // 设置 div 的 display 样式为 none
    if (divElement) {
        divElement.style.display = "none";
    } else {
        console.error("无法找到指定的 div 元素");
    }
    var divElement_c = document.getElementById("connectionLog");
    divElement_c.style.display = "block";
}

function changeStretchState() {
    currentMode = 'stretch';
    stretchState = 0;
    clearSelectedMesh();
    updateInfo();
    // 获取目标 div 元素（假设 div 的 id 是 "myDiv"）
    var divElement = document.getElementById("connectionLog");
    // 设置 div 的 display 样式为 none
    if (divElement) {
        divElement.style.display = "none";
    } else {
        console.error("无法找到指定的 div 元素");
    }
    var divElement_s = document.getElementById("dimensionChanges");
    divElement_s.style.display = "block";
}

document.getElementById('connectModeBtn').addEventListener('click', () => {
    changeConnectState()
});
document.getElementById('stretchModeBtn').addEventListener('click', () => {
    changeStretchState()
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
    // 只要 firstitem/seconditem 的字符串里解析到 name == meshName 就算匹配
    const keys = Object.keys(connItem);
    const firstKey = keys[0];
    const secondKey = keys[1];
    const firstConn = parseConnectionString(connItem[firstKey] || '');
    const secondConn = parseConnectionString(connItem[secondKey] || '');
    return (firstConn.name === meshName) || (secondConn.name === meshName);
}


/**
 * 将dimensionChangeLog里的内容渲染到 #dimensionLogInner 
 * 让用户看到每一次的尺寸变化
 */
function renderDimensionChangeLog() {
    const container = document.getElementById('dimensionLogInner');
    if (!container) return;
    container.innerHTML = '';
    dimensionChangeLog.forEach((record, idx) => {
        const line = document.createElement('div');
        line.textContent = `[${idx + 1}] Mesh "${record.meshName}" axis "${record.axis}" changed from ${record.oldVal.toFixed(2)} to ${record.newVal.toFixed(2)}`;
        container.appendChild(line);
    });
}


// ===============================
//  渲染“Connections”面板
//  selectedMeshName：可选参数；若有，会将相关连接排在最前
// ===============================
function renderConnectionLog() {
    let selectedMeshName = null
    if (selectedMesh && selectedMesh.name) {
        selectedMeshName = selectedMesh.name;
    }
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
    const keys = Object.keys(item);
    const firstKey = keys[0];
    const secondKey = keys[1];
    const firstStr = item[firstKey] || '';
    const secondStr = item[secondKey] || '';

    const textBlock = document.createElement('div');
    textBlock.innerHTML = `
        FirstMesh => ${escapeHtml(firstStr)} <br>
        SecondMesh => ${escapeHtml(secondStr)}
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
    // editingData = { firstStr, secondStr }

    // 创建输入框
    const firstInput = document.createElement('input');
    firstInput.type = 'text';
    firstInput.style.width = '90%';
    firstInput.value = editingData.firstStr;
    parentDiv.appendChild(document.createTextNode('firstMesh => '));
    parentDiv.appendChild(firstInput);
    parentDiv.appendChild(document.createElement('br'));

    const secondInput = document.createElement('input');
    secondInput.type = 'text';
    secondInput.style.width = '90%';
    secondInput.value = editingData.secondStr;
    parentDiv.appendChild(document.createTextNode('secondMesh => '));
    parentDiv.appendChild(secondInput);
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
        saveEditingConnection(item, firstInput.value, secondInput.value);
    });
    parentDiv.appendChild(saveBtn);
}

/**
 * 进入编辑模式
 * 在 editingConnections 中登记此条的 firstmesh/secondmesh 原始值
 */
function startEditingConnection(item) {
    const keys = Object.keys(item);
    const firstKey = keys[0];
    const secondKey = keys[1];
    editingConnections.set(item, {
        firstStr: item[firstKey] || '',
        secondStr: item[secondKey] || ''
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
 * - firstStrNew / secondStrNew 是用户在输入框里改过的值
 */
function saveEditingConnection(item, firstStrNew, secondStrNew) {
    // 1) 校验 firstStrNew
    if (!validateConnectionStringFormat(firstStrNew)) {
        alert('Invalid firstMesh connection string format!');
        return;
    }

    // 2) 校验 secondStrNew
    if (!validateConnectionStringFormat(secondStrNew)) {
        alert('Invalid secondMesh connection string format!');
        return;
    }

    const keys = Object.keys(data);
    const firstKey = keys[0];
    const secondKey = keys[1];

    // 若都通过 => 更新 item
    item[firstKey] = firstStrNew;
    item[secondKey] = secondStrNew;

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

function resetStretchProcess() {
    stretchState = 0
    stretchMeshA = null;
    stretchFaceIndexA = -1;
    stretchMeshB = null;
    stretchFaceIndexB = -1;
    clearSelectedMesh();
    updateInfo();
}

function findSiblingKeysFor(meshAName, meshBName) {
    // 1) 拿到从 root 到 A、B 的路径
    const pathA = Utils.findPathInFurnitureData(furnitureData.meta, meshAName);
    const pathB = Utils.findPathInFurnitureData(furnitureData.meta, meshBName);

    if (!pathA || !pathB) {
        // 若找不到，说明 furnitureData 里没收录它们，就直接退回
        console.warn("Cannot find path for A or B in furnitureData", meshAName, meshBName);
        return { keyA: meshAName, keyB: meshBName };
        // 退而求其次，直接返回它们自己的名字
    }

    // 2) 找到第一个分叉点
    let i = 0;
    while (i < pathA.length && i < pathB.length && pathA[i] === pathB[i]) {
        i++;
    }
    // i 此刻是分叉下标(或者已经超出某一路径)

    // 如果 i==0，说明根节点就不一样 => keys 就是 pathA[0].object vs pathB[0].object
    // 若 i == pathA.length || pathB.length，说明 A/B 是彼此祖先关系 => 
    //   但是我们仍然把最后一个节点当做 "self"
    if (i === 0) {
        // 直接用最顶层
        return {
            keyA: pathA[0].object,
            keyB: pathB[0].object
        };
    }

    // 3) 这里 i>0 => pathA[i-1] 是它们的最近公共父节点
    //    pathA[i] 是 A 独有分支的节点(在公共父节点之下), pathB[i] 类似
    //    这两个节点就是 siblings
    if (i < pathA.length && i < pathB.length) {
        // 正常分叉
        return {
            keyA: pathA[i].object,
            keyB: pathB[i].object
        };
    } else {
        // 有一种情况：其中一路可能到底了 => 说明 B 是 A 的祖先或反之
        //   例如 A: [Root, Base, Leg_Front_Left], B: [Root, Base]
        //   i=2, pathA[2] = Leg_Front_Left, pathB[2] 不存在
        //   => siblings = (Leg_Front_Left, Base) ?
        //   你可根据需求决定
        const lastA = pathA[pathA.length - 1];
        const lastB = pathB[pathB.length - 1];
        return {
            keyA: lastA.object,
            keyB: lastB.object
        };
    }
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

// 计算“meshA在axis方向需要变成多长，才能让A的这个面平齐到meshB那面”
// 原理：
//   - 拿到A面在世界空间的“对侧面”点 planeA_oppo
//   - 拿到B面在世界空间的planeB
//   - distance = 投影到axis方向(planeB - planeA_oppo)
//   - A.dimensions[axis] = distance
function doStretchAlignFaceAtoFaceB(meshA, faceIndexA, meshB, faceIndexB) {
    // 1) 找出A的 axisA, signA
    const { axis: axisA, sign: signA } = Utils.getFaceAxisAndSign(meshA, faceIndexA); // 这个函数没有问题
    if (!axisA) return;
    // console.log("axisA:", axisA, signA);
    // 保存 oldVal
    const oldVal = meshA.geometry.parameters[axisA];

    // 2) 找出B的世界空间“中心点” planeB_center
    //    同理 A面与对侧面各自中心点 planeA_center / planeA_oppo_center
    //    这里用 boundingBox 或者用 geometry顶点来算中心
    meshA.updateMatrixWorld(true);
    meshB.updateMatrixWorld(true);

    // =========== 获取某个面的中心(世界坐标) ===========
    function getFaceCenterWorld(mesh, rawFaceIndex) {
        const { axis, sign } = Utils.getFaceAxisAndSign(mesh, rawFaceIndex);
        const half = mesh.geometry.parameters[axis] * 0.5;
        let centerLocal = new THREE.Vector3(0, 0, 0);
        if (axis === 'width') centerLocal.x = sign * half;
        if (axis === 'height') centerLocal.y = sign * half;
        if (axis === 'depth') centerLocal.z = sign * half;
        return mesh.localToWorld(centerLocal.clone());
    }

    const A_faceCenter_oppo = getFaceCenterWorld(meshA, faceIndexA ^ 1);
    const B_faceCenter = getFaceCenterWorld(meshB, faceIndexB);

    console.log("face_center", A_faceCenter_oppo, B_faceCenter);

    let diffVec = new THREE.Vector3().subVectors(B_faceCenter, A_faceCenter_oppo);
    let delta = 0;
    if (axisA == 'width') delta = diffVec.x;
    if (axisA === 'height') delta = diffVec.y;
    if (axisA === 'depth') delta = diffVec.z;
    delta = delta * signA;

    // 遍历所有的连接关系 如果另一端有连接关系，那么delta = delta * 2，否则保持原值
    // 如果本端有连接关系 那么就无法伸缩 报错！
    // @TODO!!!
    const newVal = oldVal + delta;
    if (newVal < 0) {
        alert('Invalid Stretch!');
    }

    updateDimensionAndOffsetInMeta(furnitureData.meta, meshA.name, axisA, newVal);

    // // 在meshA局部里，该面法线
    // let unitVecA_local = new THREE.Vector3(0, 0, 0);
    // if (axisA === 'width') unitVecA_local.x = 1 * signA;
    // if (axisA === 'height') unitVecA_local.y = 1 * signA;
    // if (axisA === 'depth') unitVecA_local.z = 1 * signA;

    // // 转到世界坐标后，做点积
    // let unitVecA_world = unitVecA_local.clone().applyMatrix4(meshA.matrixWorld);
    // let posA = meshA.getWorldPosition(new THREE.Vector3());
    // unitVecA_world.sub(posA).normalize();

    // let newDimension = diffVec.dot(unitVecA_world);



    // if (newDimension < 0) newDimension = Math.abs(newDimension);

    // // 4. 计算位移：为了保持固定面（选中面）位置不变，
    // //    新生成的 BoxGeometry（总是中心对称）中，选中面原本应位于 sign*(newDimension/2)
    // //    而原来固定面在局部坐标中是 sign*(oldVal/2)；
    // //    为保持固定面位置不变，meshA 的 position 需要调整： delta = (oldVal - newDimension)/2 * signA
    // // let delta = ((oldVal - newDimension) / 2) * signA;
    // console.log("delta:", delta);
    // updateDimensionAndOffsetInMeta(furnitureData.meta, meshA.name, axisA, newDimension, delta);

    render_furniture(furnitureData, connectionData);

    // *** 记录到 dimensionChangeLog
    dimensionChangeLog.push({
        meshName: meshA.name,
        axis: axisA,
        oldVal: oldVal,
        newVal: newVal
    });

    // *** new code: 更新显示
    renderDimensionChangeLog();
}

let firstAnchorStr = null
let firstMeshType = null

// ============ 事件监听(连接模式/拉伸模式) ============
function onPointerUp(event) {

    if (event.target != renderer.domElement) {
        return
    }
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

                    // 获取lowest siblings name
                    const { keyA, keyB } = findSiblingKeysFor(firstMesh.name, secondMesh.name);

                    connectionData.data.push({
                        [keyA]: firstConnStr,
                        [keyB]: secondConnStr
                    });

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
        // mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        // mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
        // raycaster.setFromCamera(mouse, camera);
        // const intersects = raycaster.intersectObjects(scene.children, true);

        if (intersects.length > 0) {
            const hit = intersects[0];
            const hitObject = hit.object;

            // 只有是 Mesh 且是 BoxGeometry 时才执行
            if (hitObject.isMesh && hitObject.geometry && hitObject.geometry.parameters) {
                // showStretchPanel(hitObject, faceIndex);
                if (stretchState === 0) {
                    // 选中 A 面
                    if (intersects.length > 0) {
                        const hitObject = intersects[0].object;
                        selectMesh(hitObject);
                        stretchMeshA = hitObject;
                        // stretchFaceIndexA = faceIndex;
                        stretchState = 1;
                        updateInfo();  // 更新提示
                    } else {
                        // 点到空白 => 无事发生
                    }
                }
                else if (stretchState === 1) {
                    if (intersects.length > 0) {
                        const hit = intersects.find(item => item.object == stretchMeshA)
                        if (!hit) {
                            resetStretchProcess()
                        } else {
                            stretchFaceIndexA = hit.faceIndex;
                            stretchState = 2;
                            updateInfo();
                        }
                    }
                }
                else if (stretchState === 2) {
                    if (intersects.length > 0) {
                        const hitObject = intersects[0].object;
                        if (hitObject === stretchMeshA) {
                            resetStretchProcess();
                        } else {
                            clearSelectedMesh();
                            selectMesh(hitObject);
                            stretchMeshB = hitObject;
                            stretchState = 3;
                        }
                    } else {
                        resetStretchProcess()
                    }
                }
                else if (stretchState === 3) {
                    // 选中 B 面 => 执行对齐 => 重置
                    if (intersects.length > 0) {
                        const hit = intersects.find(item => item.object == stretchMeshB);
                        if (!hit) {
                            // console.log("11111");
                            resetStretchProcess();
                        } else {
                            // console.log("222222");
                            stretchFaceIndexB = hit.faceIndex;
                            doStretchAlignFaceAtoFaceB(
                                stretchMeshA,
                                stretchFaceIndexA,
                                stretchMeshB,
                                stretchFaceIndexB
                            );
                            // 重置
                            stretchState = 0;
                            stretchMeshA = null;
                            stretchFaceIndexA = -1;
                            stretchMeshB = null;
                            stretchFaceIndexB = -1;
                            clearSelectedMesh()
                            updateInfo();
                        }
                    } else {
                        resetStretchProcess()
                    }
                }
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

function switchmode(event) {
    if (event.key === 'c' || event.key === 'C') {
        changeConnectState()
    } else if (event.key === 'T' || event.key === 't') {
        changeStretchState()
    }
}

window.addEventListener('mousedown', onPointerDown, false);
window.addEventListener('mousemove', onPointerMove, false);
window.addEventListener('mouseup', onPointerUp, false);
window.addEventListener('keydown', switchmode, false);

updateInfo();

function detectOrientationHierarchy(meta) {
    // 若 meta.object_type === 'group' 或 'board'/'block'/'bar' 都可处理。
    // 这里我们都统一按照 “children” 递归，但要注意 group 视为整体 vs. mesh 是个单体

    const result = {
        objectName: meta.object || '(unnamed)',
        childrenOrientation: [],
        children: []
    };

    // 若没有 children 或 children.length < 2，无需做对比
    if (!meta.children || meta.children.length === 0) {
        return result;
    }

    // 同级 children 两两对比 => 先收集 boundingBox
    //   如果 child 是 group，则 boundingBox = union(其所有子mesh)
    //   如果 child 是 mesh，则 boundingBox = 该mesh
    // 要获取场景里的 Object3D => 我们用 objectsByName[childName]
    const siblingsInfo = meta.children.map(childMeta => {
        const name = childMeta.meta.object;
        const obj3D = objectsByName[name];
        return {
            meta: childMeta.meta,
            name,
            box: Utils.computeWorldBoundingBoxForObject(obj3D) //见下方函数
        };
    });

    // 两两对比
    for (let i = 0; i < siblingsInfo.length; i++) {
        for (let j = i + 1; j < siblingsInfo.length; j++) {
            const A = siblingsInfo[i];
            const B = siblingsInfo[j];
            if (!A.box || !B.box) continue; //若缺失

            // A->B
            const relAtoB = Utils.getOrientationLabels(A.box, B.box);
            const relBtoA = Utils.getOrientationLabels(B.box, A.box);
            // B->A
            // 如果你只想记录一次，就只存 "A sees B => relAtoB"
            // 也可以存 "B sees A => relBtoA" 同时在一个记录里保存
            result.childrenOrientation.push({
                objectA: A.name,
                objectB: B.name,
                relation: relAtoB
            });
            result.childrenOrientation.push({
                objectA: B.name,
                objectB: A.name,
                relation: relBtoA
            });
        }
    }

    // 然后对每个 child 若是 group，也要往下递归
    meta.children.forEach(child => {
        const childMeta = child.meta;
        // 如果 childMeta.object_type === 'group' 并且有 children，则深入
        if (childMeta.object_type === 'group' && Array.isArray(childMeta.children) && childMeta.children.length > 0) {
            const sub = detectOrientationHierarchy(childMeta);
            result.children.push(sub);
        }
        // 若不是 group，就不再深入
    });

    return result;
}

// 如有更多字段（不止 seat/base），可遍历 item 的 key 做更通用的查找。
function connectionExists(meshA, meshB) {

    const nameA = meshA.name;
    const nameB = meshB.name;

    for (const item of connectionData.data) {

        const keys = Object.keys(item);
        const firstKey = keys[0];
        const secondKey = keys[1];

        const firstStr = item[firstKey] || '';
        const secondStr = item[secondKey] || '';

        const cA = parseConnectionString(firstStr);
        const cB = parseConnectionString(secondStr);

        // 判断此条连接是否包含 nameA & nameB
        const names = [cA.name, cB.name];
        if (names.includes(nameA) && names.includes(nameB)) {
            return true;
        }
    }
    return false;
}

function detectAndAddConnections() {
    // 先收集场景中所有Mesh
    const allMeshes = Utils.getAllMeshesInScene(currentFurnitureRoot);

    // 设定一个接触阈值(若 bounding boxes 在某轴仅差 <= eps 就算接触)
    const eps = 1e-3;

    for (let i = 0; i < allMeshes.length; i++) {
        for (let j = i + 1; j < allMeshes.length; j++) {
            const meshA = allMeshes[i];
            const meshB = allMeshes[j];

            // 1) 判断是否已经在 connectionData 中
            if (connectionExists(meshA, meshB)) {
                continue; // 已记录连接，不再重复
            }
            // 2) 检测它们是否接触
            const contactInfo = Utils.checkBoundingBoxContact(meshA, meshB, eps);
            if (contactInfo.isTouching) {
                // 3) 两者接触，生成对应的 anchor 字符串
                const anchorA = Utils.guessAnchorFromContact(meshA, contactInfo.contactAxis, contactInfo.contactPointA);
                const anchorB = Utils.guessAnchorFromContact(meshB, contactInfo.contactAxis, contactInfo.contactPointB);
                // 4) 写入 connectionData
                // 这里为了和你现有结构兼容，我们依然写 "Seat" & "Base"。
                //   - 如果 meshA.name.includes('Seat') 就把它当Seat，否则当Base；你也可以更灵活判断。
                const keyA = meshA.name
                const keyB = meshB.name
                // -------------- 简易写法：--------------
                const connItem = {};
                connItem[keyA] = `<${meshA.name}><${Utils.getObjectType({ width: meshA.geometry.parameters.width, height: meshA.geometry.parameters.height, depth: meshA.geometry.parameters.depth })}>[${anchorA}]`;
                connItem[keyB] = `<${meshB.name}><${Utils.getObjectType({ width: meshB.geometry.parameters.width, height: meshB.geometry.parameters.height, depth: meshB.geometry.parameters.depth })}>[${anchorB}]`;
                // push 到 connectionData
                connectionData.data.push(connItem);
            }
        }
    }

    // 如果有新连接，重新渲染
    render_furniture(furnitureData, connectionData);
}


function exportAllData() {

    // 生成方位关系数据
    const orientationData = detectOrientationHierarchy(furnitureData.meta);
    // 将数据组装成一个对象
    const dataToExport = {
        furnitureData: furnitureData,
        connectionData: connectionData,
        orientationData: orientationData
    };

    // 转成字符串，并且格式化一下（缩进2格）
    const jsonStr = JSON.stringify(dataToExport, null, 2);

    if (isProd) {
        window.parent.postMessage(JSON.stringify({ event: 'export', data: { json: jsonStr } }), '*')
    } else {
        // 创建一个 Blob 对象，类型为 JSON
        const blob = new Blob([jsonStr], { type: 'application/json' });
        // 生成一个临时 URL
        const url = URL.createObjectURL(blob);

        // 创建一个 <a> 标签，用于下载
        const link = document.createElement('a');
        link.href = url;
        link.download = 'export.json';  // 下载文件名
        link.click();

        // 释放 URL 对象
        URL.revokeObjectURL(url);
    }
}

const exportBtn = document.getElementById('exportBtn');
exportBtn.addEventListener('click', () => {

    // 先做碰撞检测 => 给未记录的相邻部件补充连接数据
    detectAndAddConnections();

    //调用导出函数
    exportAllData();
});

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
