// 引入 Three.js 与 OrbitControls
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import jsonData from './output_2.json' assert { type: 'json' };
import ConnData from './Table_1.json' assert { type: 'json' };

const furnitureData = jsonData; 
const connectionData = ConnData;

// =============================
// 新增：连接日志与管理
// =============================
let connectionCount = 0; // 递增ID
const connectionLog = []; // 用于记录每一次连接

const connectionLogContainer = document.getElementById('connectionLog'); 

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

  // 可根据 objectType 做特殊处理，比如设置不同颜色或贴图等，TODO
  // if (objectType === 'board') { ... }
  // if (objectType === 'block') { ... }
  // if (objectType === 'bar')   { ... }

  return mesh;
}

const objectsByName = {}; // 用来存储 "meta.object" -> 生成的 Mesh 或 Group

// 递归解析 JSON，生成 Three.js 对象
function parseMeta(meta) {
  let currentObject;

  // 如果是 group，就用 Group；否则就用 Mesh
  if (meta.object_type === 'group') {
    currentObject = new THREE.Group();
  } else {
    currentObject = createMesh(meta.object_type, meta.dimensions);
  }

  // 给这个对象命个名字，方便后续查询
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

  console.log(meta, currentObject)

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

function getCenterPoint(mesh) {
    var middle = new THREE.Vector3();
    var geometry = mesh.geometry;

    geometry.computeBoundingBox();

    middle.x = (geometry.boundingBox.max.x + geometry.boundingBox.min.x) / 2;
    middle.y = (geometry.boundingBox.max.y + geometry.boundingBox.min.y) / 2;
    middle.z = (geometry.boundingBox.max.z + geometry.boundingBox.min.z) / 2;

    mesh.localToWorld( middle );
    return middle;
}

// --------------------------------------------------------------------------------------------
//  根据 anchors 列表，计算该物体在局部坐标的“锚点位置” (x, y, z)
//    目前只处理 <BottomFace>/<TopFace>/<FrontLeftCorner>/<FrontRightCorner>/<BackLeftCorner>/<BackRightCorner>
// --------------------------------------------------------------------------------------------
function calcLocalAnchorPosition(object3D, anchors) {
    // 首先要知道这个物体的宽高深。因为我们之前用 BoxGeometry(width, height, depth) + 中心在(0,0,0)。
    // 我们可以从 geometry.parameters 里拿到实际尺寸
    // 但需要确保 object3D 真的是 Mesh，且 geometry 是 BoxGeometry
    // 如果 object3D 是 Group，就可能没有 geometry，要看具体需求怎么处理
    const mesh = (object3D.isMesh) ? object3D : null;
    if (!mesh || !mesh.geometry || !mesh.geometry.parameters) {
      // 如果不是 Mesh 或不满足我们预期，就返回(0,0,0)或抛错
      return new THREE.Vector3(0,0,0);
    }
  
    const { width, height, depth } = mesh.geometry.parameters;

    const Center = getCenterPoint(mesh); 
    let x = Center.x, y = Center.y, z = Center.z;
  
    // 遍历 anchors
    anchors.forEach(anchor => {
      // 判断一些关键标签
      switch(anchor) {
        case 'BottomFace':
          y = -height/2;
          break;
        case 'TopFace':
          y = +height/2;
          break;
        case 'FrontLeftCorner':
          x = -width/2;
          z = -depth/2;
          break;
        case 'FrontRightCorner':
          x = +width/2;
          z = -depth/2;
          break;
        case 'BackLeftCorner':
          x = -width/2;
          z = +depth/2;
          break;
        case 'BackRightCorner':
          x = +width/2;
          z = +depth/2;
          break;
        // 你可以继续扩展更多标签
        default:
          // 未知标签，这里先不处理
          break;
      }
    });
  
    return new THREE.Vector3(x, y, z);
  }

// --------------------------------------------------------------------------------------------
// “连接分组” 逻辑：给每个 Object3D 分配一个 “connectionGroup”(THREE.Group)
// --------------------------------------------------------------------------------------------
// 从 object.userData 中获取 (或创建) 它的 connectionGroup
function getOrCreateConnectionGroup(obj) {
    // 如果已经有 connectionGroup，就返回
    if (obj.userData.connectionGroup) {
      return obj.userData.connectionGroup;
    }
  
    // 否则创建一个新 group
    const newGroup = new Set();
  
    // 把 obj 以“保持世界变换不变”的方式，attach 到 group
    // 这会自动处理好位置/旋转等
    newGroup.add(obj);
  
    obj.userData.connectionGroup = newGroup;
  
    return newGroup;
  }


// 把 groupB 的所有孩子都 attach 到 groupA
function unifyGroups(groupA, groupB) {
    // 把 groupB 里的所有子对象都 attach 到 groupA
    // 这样它们的世界变换不会变，直接重挂
    groupB.forEach(item => {
        item.userData.connectionGroup = groupA;
        groupA.add(item)
    });
    return groupA
  }


// --------------------------------------------------------------------------------------------
// 真正处理连接：让 ObjA 的某个 anchor 对齐到 ObjB 的某个 anchor
//    同时确保它们在同一个 connectionGroup 里
// --------------------------------------------------------------------------------------------
function applyConnections(connectionData) {
    const list = connectionData.data;
    if (!list || !Array.isArray(list)) return;
  
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

        // ==========以下是新增的group逻辑
        // 先让 seatObj 和 baseObj 各自进到某个 connectionGroup
        const groupA = getOrCreateConnectionGroup(seatObj);
        const groupB = getOrCreateConnectionGroup(baseObj);

        if (groupA === groupB) {
            console.warn('group equal', groupA)
            return;
        }

        // ==========以上是新增的group逻辑
  
        // 计算它们的世界坐标 anchor
        // 先各自更新一次世界矩阵
        seatObj.updateMatrixWorld(true);
        baseObj.updateMatrixWorld(true);
    
        // seatObj 的局部锚点
        const seatLocalAnchor = calcLocalAnchorPosition(seatObj, seatConn.anchors);
        
        // 转成世界坐标
        const seatWorldAnchor = seatObj.localToWorld(seatLocalAnchor.clone());
    
        // baseObj 的局部锚点
        const baseLocalAnchor = calcLocalAnchorPosition(baseObj, baseConn.anchors);
        
        // 转成世界坐标
        const baseWorldAnchor = baseObj.localToWorld(baseLocalAnchor.clone());

        console.log(seatLocalAnchor)
        console.log(seatWorldAnchor)
        console.log(baseLocalAnchor)
        console.log(baseWorldAnchor)
    
        // 让 seatObj 的锚点贴到 baseObj 的锚点位置
        // 最简单的做法：seatObj.position += (baseWorldAnchor - seatWorldAnchor)
        // 这里假设 seatObj.parent == scene，如果父级层次更深，需要考虑 parent 的局部坐标
        const offset = new THREE.Vector3().subVectors(seatWorldAnchor, baseWorldAnchor);

        groupB.forEach(item => {
            item.position.add(offset)
        })
        // 如果 groupA != groupB，则合并
        unifyGroups(groupA, groupB);
    });
  }


// 创建 Three.js 场景
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const axesHelper = new THREE.AxesHelper( 500 );
scene.add( axesHelper );


const dir_x = new THREE.Vector3( 1, 0, 0 );
const dir_y = new THREE.Vector3( 0, 0, 1 );
const dir_z = new THREE.Vector3( 0, 1, 0 );

//normalize the direction vector (convert to vector of length 1)
dir_x.normalize();
dir_y.normalize();
dir_z.normalize();

const origin = new THREE.Vector3( 0, 0, 0 );
const length = 1500;
const hex_x = 0xffff00;
const hex_y = 0x00ffff;
const hex_z = 0xff00ff;


const arrowHelper_x = new THREE.ArrowHelper( dir_x, origin, length, hex_x );
const arrowHelper_y = new THREE.ArrowHelper( dir_y, origin, length, hex_y );
const arrowHelper_z = new THREE.ArrowHelper( dir_z, origin, length, hex_z );
scene.add( arrowHelper_x );
scene.add( arrowHelper_y );
scene.add( arrowHelper_z );


// 创建相机
const camera = new THREE.PerspectiveCamera(
  75, // 视野(FOV)
  window.innerWidth / window.innerHeight, // 宽高比
  0.1, // 近裁剪面
  100000 // 远裁剪面
);
camera.position.set(0, 800, 1500);
camera.lookAt(0, 0, 0);

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

// 将解析出来的家具对象添加到场景
const rootObject = parseMeta(furnitureData.meta);
console.log(rootObject)
scene.add(rootObject);

// --------------------------------------------------------------------------------------------
// 在所有对象创建完成后，应用“连接关系”逻辑
// --------------------------------------------------------------------------------------------
applyConnections(connectionData);

// 方便鼠标交互旋转、缩放
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.update();

// ******* 新增：以下是交互逻辑 ******* //

function addConnectionRecord(objA, snapPosA, objB, snapPosB, offset, groupA, groupB) {
    connectionCount++;
    const id = connectionCount;
    
    // 将本次连接信息保存到 connectionLog 数组
    // 除了保存 objectA/objectB，还需要记录它们在合并前 groupB 的所有 item 的 原始位置(世界坐标)
    // 以便撤销时能够还原
    // （如果 groupB 中不只一个 item，我们需要记录每个 item 的 originalWorldPos）
    const groupBPositions = [];
    groupB.forEach(item => {
      const wp = new THREE.Vector3();
      item.getWorldPosition(wp);
      groupBPositions.push({ object: item, pos: wp.clone() });
    });
  
    const connInfo = {
      id,
      objA,
      objB,
      snapPosA: snapPosA.clone(),
      snapPosB: snapPosB.clone(),
      offset: offset.clone(),
      groupA,
      groupB,
      groupBPositions
    };
    connectionLog.push(connInfo);
  
    // 在面板中添加一条显示
    const itemDiv = document.createElement('div');
    itemDiv.className = 'conn-item';
    itemDiv.innerHTML = `
      <div>Connection #${id}:
        <br/>A: ${objA.name}
        <br/>B: ${objB.name}
      </div>
    `;
    // 添加“取消”按钮
    const removeBtn = document.createElement('button');
    removeBtn.innerText = 'Remove';
    removeBtn.onclick = () => {
      removeConnection(id, itemDiv);
    };
    itemDiv.appendChild(removeBtn);
  
    connectionLogContainer.appendChild(itemDiv);
}

// 取消连接
function removeConnection(id, domElement) {
    // 在 connectionLog 找到对应记录
    const index = connectionLog.findIndex(item => item.id === id);
    if (index < 0) return;
  
    const connInfo = connectionLog[index];
  
    // 确保 groupB 再次从 groupA 脱离
    // 1) 如果 connInfo.groupA == connInfo.groupB 说明已经合并成同一个Set
    // 2) 我们要把 groupB 里的所有 item 从 groupA 中拿出来
    // 3) 并把它们的 position 恢复到原始记录
    const { groupA, groupB, groupBPositions, offset } = connInfo;
  
    // 如果 groupA 和 groupB 已经是同一个 set，拆分时要新建一个 setB
    const newSetB = new Set();
    groupB.forEach(item => {
      // 把 item 从 groupA 中剔除
      groupA.delete(item);
      // 还原 item 的 userData.connectionGroup 指向 newSetB
      item.userData.connectionGroup = newSetB;
      newSetB.add(item);
    });
  
    // 还原位置
    groupBPositions.forEach(entry => {
      const { object, pos } = entry;
      // setWorldPosition
      // 由于 position.set(x,y,z) 是局部坐标，需要先把 object.parent==scene 或根
      // 我们可以先 detach 再 attach
      let parentBefore = object.parent;
      if (parentBefore) {
        parentBefore.remove(object);
      }
      // 先放到 scene
      scene.add(object);
  
      // 计算 oldPos 在 scene 下的坐标
      object.position.copy(pos);
    });
    
    // 最后，从日志中移除这条记录
    connectionLog.splice(index, 1);
  
    // 从UI面板移除
    if (domElement && domElement.parentNode) {
      domElement.parentNode.removeChild(domElement);
    }
}

let currentMode = 'connect'; // 'connect' or 'stretch'
const infoDiv = document.getElementById('info');



// -- 用于“连接模式”时，先点第一个，再点第二个 --
const SNAP_STEP = 50; // 以 50mm 为吸附步长
let firstPickedObject = null;
let firstPickedPoint = new THREE.Vector3();

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

// =============================
// 获取 BoxGeometry 面对应的轴
//   faceIndex -> faceId = floor(faceIndex/2)
//   根据 faceId 判断 +X/-X, +Y/-Y, +Z/-Z
// =============================
function getFaceAxisByIndex(faceIndex) {
    const faceId = Math.floor(faceIndex / 2);
    // BoxGeometry 通常 0->+Z,1->-Z,2->+Y,3->-Y,4->+X,5->-X (部分版本可能顺序不同)
    switch(faceId) {
      case 0: return { axis: 'width', sign: +1 };   // +Z
      case 1: return { axis: 'width', sign: -1 };   // -Z
      case 2: return { axis: 'height', sign: +1 };  // +Y
      case 3: return { axis: 'height', sign: -1 };  // -Y
      case 4: return { axis: 'depth',  sign: +1 };  // +X
      case 5: return { axis: 'depth',  sign: -1 };  // -X
      default: return { axis: null, sign: 0 };
    }
  }

// =============================
// 当用户点击某个面时，显示面板并填入数据
// =============================
function showStretchPanel(mesh, faceIndex) {
    if (!mesh.geometry || !mesh.geometry.parameters) return;
  
    const { width, height, depth } = mesh.geometry.parameters;
    const { axis, sign } = getFaceAxisByIndex(faceIndex);
  
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
    if (axis === 'width')  currentVal = width;
    if (axis === 'height') currentVal = height;
    if (axis === 'depth')  currentVal = depth;
  
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
  
    // 取当前 geometry
    const geometry = pickedMeshForStretch.geometry;
    if (!geometry || !geometry.parameters) return;
    let { width, height, depth } = geometry.parameters;
  
    // 根据 pickedFaceAxis 修改对应维度
    if (pickedFaceAxis === 'width')  width  = newVal;
    if (pickedFaceAxis === 'height') height = newVal;
    if (pickedFaceAxis === 'depth')  depth  = newVal;
  
    // 重新创建 BoxGeometry
    pickedMeshForStretch.geometry.dispose(); 
    pickedMeshForStretch.geometry = new THREE.BoxGeometry(width, height, depth);
    pickedMeshForStretch.geometry.computeBoundingBox();
    pickedMeshForStretch.geometry.computeBoundingSphere();
  
    // 更新 geometry.parameters 里保存的值
    pickedMeshForStretch.geometry.parameters.width  = width;
    pickedMeshForStretch.geometry.parameters.height = height;
    pickedMeshForStretch.geometry.parameters.depth  = depth;
  
    // 更新界面
    stretchCurrentSizeSpan.innerText = newVal.toFixed(1);
  
    alert('Dimension updated!');
});

// // 区分 face 在本地坐标下方向的简易函数
// function getFaceNormalDirection(mesh, faceIndex) {
// // 对 BoxGeometry，每个面可能对应 +x, -x, +y, -y, +z, -z
// // faceIndex 在 BoxGeometry 通常是两三角面代表一个“面”，需要把它对应到 Box 的 6 个面
// // 一个面的两个三角，所以 faceIndex // 2 可以表示对应第几个面(0~5)
// // 但更稳定的做法是通过 geometry.groups
// // 这里只做一个简单映射：
// const faceId = Math.floor(faceIndex / 2);
// // faceId: 0-> +z,1-> -z,2-> +y,3-> -y,4-> +x,5-> -x (this is typical for BoxGeometry, 可能视three版本变化)
// switch(faceId) {
//     case 0: return new THREE.Vector3(0, 0, 1);
//     case 1: return new THREE.Vector3(0, 0, -1);
//     case 2: return new THREE.Vector3(0, 1, 0);
//     case 3: return new THREE.Vector3(0, -1, 0);
//     case 4: return new THREE.Vector3(1, 0, 0);
//     case 5: return new THREE.Vector3(-1, 0, 0);
//     default: return new THREE.Vector3(0,0,0);
// }
// }

// 更新显示文字
function updateInfo() {
    infoDiv.innerText = `Mode: ${currentMode}\n`;
    if (currentMode === 'connect') {
      infoDiv.innerText += 'Pick two objects in sequence to connect.';
    } else {
      infoDiv.innerText += 'Click on a face to see/edit dimension.';
    }
  }

// 声明一个 Raycaster
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// 切换模式
document.getElementById('connectModeBtn').addEventListener('click', () => {
    currentMode = 'connect';
    pickedMeshForStretch = null;
    pickedFaceIndex = -1;
    pickedFaceAxis = null;
    stretchPanel.style.display = 'none'; // 隐藏面板
    updateInfo();
  });

document.getElementById('stretchModeBtn').addEventListener('click', () => {
    currentMode = 'stretch';
    pickedMeshForStretch = null;
    pickedFaceIndex = -1;
    pickedFaceAxis = null;
    stretchPanel.style.display = 'none'; // 隐藏面板
    updateInfo();
});

// 配合拖拽使用 no longer needed
// function onPointerMove(event) {
//   // 记录鼠标拖动位置
//   lastMousePos.x = event.clientX;
//   lastMousePos.y = event.clientY;
// }

function onPointerDown(event) {
    mouseDown = true;
    lastMousePos.x = event.clientX;
    lastMousePos.y = event.clientY;
  
    mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
    mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
  
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
  
    if (intersects.length > 0) {
      const hit = intersects[0];
      const hitObject = hit.object; 
      const hitPointWorld = hit.point.clone();
  
      if (currentMode === 'connect') {
        // Snap 到 50mm 网格
        let localPosA = hitObject.worldToLocal(hitPointWorld.clone());
        localPosA.x = SNAP_STEP * Math.round(localPosA.x / SNAP_STEP);
        localPosA.y = SNAP_STEP * Math.round(localPosA.y / SNAP_STEP);
        localPosA.z = SNAP_STEP * Math.round(localPosA.z / SNAP_STEP);
        const snappedWorldPosA = hitObject.localToWorld(localPosA.clone());
  
        if (!firstPickedObject) {
          // 选中第一个对象
          firstPickedObject = hitObject;
          firstPickedPoint.copy(snappedWorldPosA);
        } else {
          // 第二次点击 -> 连接 secondPickedObject 到 firstPickedObject
          const secondPickedObject = hitObject;
  
          // 同样snap
          let localPosB = secondPickedObject.worldToLocal(hitPointWorld.clone());
          localPosB.x = SNAP_STEP * Math.round(localPosB.x / SNAP_STEP);
          localPosB.y = SNAP_STEP * Math.round(localPosB.y / SNAP_STEP);
          localPosB.z = SNAP_STEP * Math.round(localPosB.z / SNAP_STEP);
          const snappedWorldPosB = secondPickedObject.localToWorld(localPosB.clone());
  
          const offset = new THREE.Vector3().subVectors(firstPickedPoint, snappedWorldPosB);
  
          const groupA = getOrCreateConnectionGroup(firstPickedObject);
          const groupB = getOrCreateConnectionGroup(secondPickedObject);
  
          if (groupA !== groupB) {
            // 把 groupB 所有对象移动 offset
            groupB.forEach(item => {
              item.position.add(offset);
            });
            // 合并到 groupA
            unifyGroups(groupA, groupB);
  
            // === 新增/修改：面板与可撤销逻辑 ===
            // 记录本次连接
            addConnectionRecord(
              firstPickedObject, snappedWorldPosA,
              secondPickedObject, snappedWorldPosB,
              offset, groupA, groupB
            );
          }
  
          // 重置 firstPickedObject
          firstPickedObject = null;
        }
      }
      else if (currentMode === 'stretch') {
        mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
        mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
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
    }
  
    updateInfo();
}

// 配合拖拽式使用，no longer needed
// function onPointerUp(event) {
//     mouseDown = false;
//     pickedMeshForStretch = null;
//     pickedFaceIndex = -1;
// }
  
  // 拖动时更新 stretch NO longer needed
// function onPointerDrag(event) {
//     if (!mouseDown) return;
//     if (currentMode !== 'stretch') return;
//     if (!pickedMeshForStretch || pickedFaceIndex < 0) return;
  
//     const dy = event.clientY - lastMousePos.y; // 拖动的垂直方向像素
//     // 可以定义一个像素->尺寸的比例
//     const scaleFactor = 1; // 先简单处理：拖动 1 像素 -> 改变 1mm
  
//     // 判断面法线方向(在mesh本地坐标)
//     // e.g. (0,1,0) 表示是上表面
//     const normalDir = getFaceNormalDirection(pickedMeshForStretch, pickedFaceIndex);
  
//     // 只做最简单的：如果 normalDir.y > 0.5，表示 top face -> 改变 height(正方向)
//     // 如果 normalDir.y < -0.5，表示 bottom face -> 改变 height(负方向)
//     // 如果 normalDir.x > 0.5 -> 改变 width
//     // 如果 normalDir.z > 0.5 -> 改变 depth
//     // ...
//     const geometry = pickedMeshForStretch.geometry;
//     if (!geometry || !geometry.parameters) return;
//     let { width, height, depth } = geometry.parameters;
  
//     if (normalDir.y > 0.5) {
//       // top face
//       height += (-dy * scaleFactor);
//     } else if (normalDir.y < -0.5) {
//       // bottom face
//       height += (dy * scaleFactor);
//     } else if (normalDir.x > 0.5) {
//       // right face
//       width += (-dy * scaleFactor); // 也可以换成 dx
//     } else if (normalDir.x < -0.5) {
//       // left face
//       width += (dy * scaleFactor);
//     } else if (normalDir.z > 0.5) {
//       // front face
//       depth += (-dy * scaleFactor);
//     } else if (normalDir.z < -0.5) {
//       // back face
//       depth += (dy * scaleFactor);
//     }
  
//     // 不要出现负数或 0
//     width = Math.max(1, width);
//     height = Math.max(1, height);
//     depth = Math.max(1, depth);
  
//     // 重新赋值 geometry
//     pickedMeshForStretch.geometry.dispose(); // 释放旧的
//     pickedMeshForStretch.geometry = new THREE.BoxGeometry(width, height, depth);
  
//     // 更新Three.js变换以保证中心对齐 / 重新计算 bounding
//     pickedMeshForStretch.geometry.computeBoundingBox();
//     pickedMeshForStretch.geometry.computeBoundingSphere();
  
//     // 记录新的参数
//     geometry.parameters.width = width;
//     geometry.parameters.height = height;
//     geometry.parameters.depth = depth;
  
//     lastMousePos.x = event.clientX;
//     lastMousePos.y = event.clientY;
// }

// 事件监听
window.addEventListener('mousedown', onPointerDown, false);
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
