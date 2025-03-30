// 引入 Three.js 与 OrbitControls
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import jsonData from './output_2.json' assert { type: 'json' };
import ConnData from './Table_1.json' assert { type: 'json' };

const furnitureData = jsonData; 
const connectionData = ConnData;

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
