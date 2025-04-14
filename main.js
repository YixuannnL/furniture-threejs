// 引入 Three.js 与 OrbitControls
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as Utils from './utils.js';

// import JsonData from './output_2.json' assert { type: 'json' };
// import ConnData from './Table_1.json' assert { type: 'json' };
import JsonData from './input_data/meta_data.json' assert { type: 'json' };
import ConnData from './input_data/conn_data.json' assert { type: 'json' };

// 用来暂存 pointermove 中算出的“吸附后位置”
let tempSnappedLocalPos = null;
let tempSnappedMesh = null;

// 用来记录：当前是否在按住某个键做拉伸，拉伸的是哪个轴
let scalingAxis = null;        // 取值 'width' | 'height' | 'depth' | null
let scalingStartDim = 0;       // 该轴的初始尺寸
let scalingStartMouseX = 0;    // 按下键时的鼠标 X
let scalingStartMouseY = 0;
let scalingMeshName = null;    // 正在被缩放的 mesh 名称

// 存一下最近一次 mousemove 的位置，给按下键时初始化用
let lastMouseX = 0;
let lastMouseY = 0;


let editingConnections = new Map();
let selectedMesh = null;     // 当前选中的 mesh（高亮+前置）

// 用来存储“当前家具根对象”
let currentFurnitureRoot = null;
// 用来存储 "名称->Object3D" 映射（每次 render 时重新生成）
let objectsByName = {};

// 存储所有拉伸变更的日志记录
let dimensionChangeLog = [];

/** 
 * 全局变量，用来管理“当前是否在查看连接关系”，以及“以谁为基准查看连接” 
 * 若为 null，表示当前没有在查看连接关系
 * 若非 null，表示 { baseMesh: Mesh, connectedMeshes: Mesh[], allHighlighted: boolean }
 */
let currentConnectionHighlight = null;
// 用于存储场景中所有 Mesh 的“原材质”或者“变淡材质”，以便随时切换
// 也可以不存，直接重新 render_furniture 也行，但可能会破坏用户的中间编辑状态
let originalMaterialMap = new WeakMap(); // mesh => { material, isDimmed:boolean, isHighlighted:boolean }


// ------------------- 新增：在此处对 furnitureData 做尺寸放大处理 ------------------- //
function scaleFurnitureIfTooSmall(furnitureData) {
    // 如果没有根尺寸，直接返回
    if (!furnitureData.meta || !furnitureData.meta.dimensions) return;

    const rootDim = furnitureData.meta.dimensions;
    // 计算对角线
    const diagonal = Math.sqrt(
        (rootDim.width || 0) ** 2 +
        (rootDim.height || 0) ** 2 +
        (rootDim.depth || 0) ** 2
    );

    let scaleFactor = 1;
    if (diagonal < 100) {
        scaleFactor = 10;
    } else if (diagonal < 1000) {
        scaleFactor = 5;
    }

    if (scaleFactor > 1) {
        // 递归放大 meta 的所有 dimensions
        scaleMetaDimensions(furnitureData.meta, scaleFactor);
        console.log(`对角线(${diagonal.toFixed(2)}) < 1000, 已放大 ${scaleFactor} 倍`);
    } else {
        console.log(`对角线(${diagonal.toFixed(2)}) >= 1000, 不需放大`);
    }
}

function scaleMetaDimensions(metaNode, factor) {
    // 如果有 dimensions
    if (metaNode.dimensions) {
        metaNode.dimensions.width = (metaNode.dimensions.width || 0) * factor;
        metaNode.dimensions.height = (metaNode.dimensions.height || 0) * factor;
        metaNode.dimensions.depth = (metaNode.dimensions.depth || 0) * factor;
    }

    // 若存在 children，继续递归
    if (Array.isArray(metaNode.children)) {
        metaNode.children.forEach(child => {
            if (child && child.meta) {
                scaleMetaDimensions(child.meta, factor);
            }
        });
    }
}

// 辅助：计算 THREE.Box3 的体积
function computeBoxVolume(box) {
    const size = new THREE.Vector3();
    box.getSize(size);
    return size.x * size.y * size.z;
}

// 检测并更新页面显示重叠严重的 Mesh 提示
function detectAndDisplayOverlap() {
    const overlapListDiv = document.getElementById('overlapList');
    if (!overlapListDiv || !currentFurnitureRoot) return;

    // 收集场景中所有 Mesh 对象
    let meshes = [];
    currentFurnitureRoot.traverse(obj => {
        if (obj.isMesh) {
            meshes.push(obj);
        }
    });

    const threshold = 0.75; // 超过 75% 认为严重重叠
    let overlapItems = [];

    // 两两比较
    for (let i = 0; i < meshes.length; i++) {
        let boxA = new THREE.Box3().setFromObject(meshes[i]);
        let volA = computeBoxVolume(boxA);
        for (let j = i + 1; j < meshes.length; j++) {
            let boxB = new THREE.Box3().setFromObject(meshes[j]);
            let volB = computeBoxVolume(boxB);
            if (!boxA.intersectsBox(boxB)) continue;

            let intersectionBox = boxA.clone().intersect(boxB);
            if (intersectionBox.isEmpty()) continue;

            let interVol = computeBoxVolume(intersectionBox);
            let ratio = interVol / Math.min(volA, volB);
            if (ratio > threshold) {
                overlapItems.push({
                    meshA: meshes[i].name,
                    meshB: meshes[j].name,
                    ratio: ratio
                });
            }
        }
    }

    // 清空现有显示内容
    overlapListDiv.innerHTML = "";

    if (overlapItems.length === 0) {
        const p = document.createElement("p");
        p.textContent = "未检测到严重重叠的 Mesh。";
        overlapListDiv.appendChild(p);
    } else {
        overlapItems.forEach(item => {
            const div = document.createElement("div");
            div.className = "overlap-item";

            // 创建 meshA 对应的 clickable span
            const spanA = document.createElement("span");
            spanA.textContent = item.meshA;
            spanA.style.color = "blue";
            spanA.style.cursor = "pointer";
            spanA.style.textDecoration = "underline";
            spanA.addEventListener("click", () => {
                const meshObj = objectsByName[item.meshA];
                if (meshObj) {
                    selectMesh(meshObj);
                }
            });

            // 创建 meshB 对应的 clickable span
            const spanB = document.createElement("span");
            spanB.textContent = item.meshB;
            spanB.style.color = "blue";
            spanB.style.cursor = "pointer";
            spanB.style.textDecoration = "underline";
            spanB.addEventListener("click", () => {
                const meshObj = objectsByName[item.meshB];
                if (meshObj) {
                    selectMesh(meshObj);
                }
            });

            // 组装提示文本
            const textNode = document.createTextNode(" 与 ");
            const textNode2 = document.createTextNode(" 重叠 " + (item.ratio * 100).toFixed(0) + "%");

            div.appendChild(spanA);
            div.appendChild(textNode);
            div.appendChild(spanB);
            div.appendChild(textNode2);

            overlapListDiv.appendChild(div);
        });
    }
}


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

function toggleCollapse(row, toggleBtn) {
    const currentState = row.dataset.collapsed === 'true';
    // 如果当前 collapsed='true'，说明是折叠状态，此次点击就是要展开；反之亦然
    const newState = !currentState;
    row.dataset.collapsed = newState ? 'true' : 'false';

    // 按钮文本显示
    toggleBtn.textContent = newState ? '+' : '-';

    // 拿到当前行的缩进层级
    const indent = parseInt(row.style.marginLeft) || 0;
    const thisLevel = indent / 20;

    // 遍历同一个 container 里的后续行，只要它们层级比 thisLevel 更深，就隐藏/显示
    const container = row.parentNode;
    if (!container) return;
    const allRows = Array.from(container.querySelectorAll('.tree-row'));
    const rowIndex = allRows.indexOf(row);
    if (rowIndex < 0) return;

    for (let i = rowIndex + 1; i < allRows.length; i++) {
        const testIndent = parseInt(allRows[i].style.marginLeft) || 0;
        const testLevel = testIndent / 20;
        if (testLevel <= thisLevel) {
            // 表示已经到了兄弟或父层 => 停止
            break;
        }
        // 如果我们是要折叠，则隐藏；要展开，则显示
        // 注意：如果中间子节点本身也处于折叠状态，则展开时要根据它自己的 collapsed 状态决定是否再进一步隐藏它的孙子节点
        if (newState) {
            // newState=true => 正在折叠 => 全部直接隐藏
            allRows[i].style.display = 'none';
        } else {
            // newState=false => 正在展开
            // 需要判断它的祖先是否都展开了
            // 简化策略：当前节点展开 => 只要它本身不处于 collapsed='true'，就显示
            // 还要检查它的父节点链路
            const ancestorCollapsed = hasAncestorCollapsed(allRows[i], allRows, thisLevel);
            if (!ancestorCollapsed && allRows[i].dataset.collapsed !== 'true') {
                allRows[i].style.display = '';
            }
        }
    }
}

/**
 * 用来判断：某行 row 是否在展开过程中有祖先折叠 => 即便父级展开，我们也看父级的父级...
 */
function hasAncestorCollapsed(row, allRows, parentLevel) {
    const rowIndex = allRows.indexOf(row);
    if (rowIndex < 0) return false;
    const indent = parseInt(row.style.marginLeft) || 0;
    let level = indent / 20;

    // 逐级向上寻找比自身 level 小的行 => parent
    for (let i = rowIndex - 1; i >= 0; i--) {
        const testIndent = parseInt(allRows[i].style.marginLeft) || 0;
        const testLevel = testIndent / 20;
        if (testLevel < level) {
            // 这是 row 的一个父级
            // 若它 collapsed='true'，则 row 应该保持隐藏
            if (allRows[i].dataset.collapsed === 'true') {
                return true;
            }
            level = testLevel;
        }
        if (testLevel <= parentLevel) {
            // 回到当前 fold/unfold 触发行之上的级别 => 可以停止
            break;
        }
    }
    return false;
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

    // 在此处添加 data-mesh-name（注意：仅对有名称的有效）
    const objName = meta.object || '(no-name)';
    row.dataset.meshName = objName;
    // 添加通用的CSS类名，便于以后统一选择
    row.classList.add('tree-row');
    // 新增：默认展开
    row.dataset.collapsed = 'false';

    // 显示当前节点信息
    const titleSpan = document.createElement('span');
    const objType = meta.object_type || '(no-type)';
    titleSpan.textContent = `${objName} (${objType})`;
    titleSpan.style.fontWeight = 'bold';
    row.appendChild(titleSpan);

    // 如果有子节点 => 插入折叠/展开按钮
    let toggleBtn = null;
    if (meta.children && meta.children.length > 0) {
        toggleBtn = document.createElement('button');
        toggleBtn.textContent = '-'; // 初始为展开状态 => 显示 "-"
        toggleBtn.style.marginLeft = '6px';
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();  // 防止与行点击冲突
            toggleCollapse(row, toggleBtn);
        });
        row.appendChild(toggleBtn);
    }

    // ============= [点击行 => 选中并高亮对应Mesh] =============
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
        e.stopPropagation(); // 避免冒泡；如果还有别的监听

        // 找到对应的 THREE.Object3D
        const mesh = objectsByName[objName];
        if (mesh && mesh.isMesh) {
            // 先取消任何当前高亮
            clearConnectionHighlight();
            selectMesh(mesh); // 让它 edges + renderOnTop
        } else {
            // 也可能是group
            clearConnectionHighlight();
            console.log(`Clicked a group or no mesh: ${objName}`);
        }
    });


    // 如果不是根节点，可以显示「删除」按钮
    if (parentMeta) {
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.style.marginLeft = '8px';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 不要触发行的点击
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
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            promptAddChild(meta);
        });
        row.appendChild(addBtn);
    }

    // ============= 新增一个 [Show Connection] 按钮 ============
    if (objName && objName !== '(no-name)') {
        const showConnBtn = document.createElement('button');
        showConnBtn.textContent = 'Show Connection';
        showConnBtn.style.marginLeft = '4px';
        showConnBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onShowConnectionFor(objName);
        });
        row.appendChild(showConnBtn);
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
 * 将选中行 row 在其父层级里移到最上面（不修改数据结构，仅操作DOM顺序）。
 * 假设 row.style.marginLeft = indent + 'px'，其中 indent/20 = 当前层级深度。
 */
function moveRowToTopWithinSameParent(row) {
    const container = row.parentNode;
    if (!container) return;

    // 读取当前行缩进（等级）
    const indent = parseInt(row.style.marginLeft) || 0;
    const thisLevel = indent / 20;

    // 收集 container.children 到一个数组
    const allRows = Array.from(container.querySelectorAll('.tree-row'));
    // 在 allRows 里找 row 的索引
    const rowIndex = allRows.indexOf(row);
    if (rowIndex < 0) return;  // 理论上不会

    // 1) 从 rowIndex 向上找到“父层级”的 rowIndex 或到 0 为止。
    //    其实我们这里用不到父层级行本身，只要判断不和别的同级或更高级混在一起即可；
    //    所以简单做法：直接从 rowIndex 向上，看有没有比 thisLevel 小的 (出现则停止)
    let startIndex = rowIndex;
    for (let i = rowIndex - 1; i >= 0; i--) {
        const testIndent = parseInt(allRows[i].style.marginLeft) || 0;
        const testLevel = testIndent / 20;
        if (testLevel < thisLevel) {
            // 遇到更浅层（父）了，就停止
            break;
        }
        startIndex = i;
    }

    // 2) 从 rowIndex 向下找到同级块结束位置
    //    一旦遇到 testLevel < thisLevel，说明离开本级了
    let endIndex = rowIndex;
    for (let i = rowIndex + 1; i < allRows.length; i++) {
        const testIndent = parseInt(allRows[i].style.marginLeft) || 0;
        const testLevel = testIndent / 20;
        if (testLevel < thisLevel) {
            // 遇到父级了 => 本级范围结束
            break;
        }
        endIndex = i;
    }

    // 至此 [startIndex .. endIndex] 都是“同一个父层级”。
    // 提取这段行
    const sameLevelRows = allRows.slice(startIndex, endIndex + 1);

    // 3) 在这段行里，把选中的 row 移到最前（但保持其他行的相对顺序不变）
    const newOrder = [row, ...sameLevelRows.filter(r => r !== row)];

    // 4) 真正修改 DOM 顺序：先把 oldRows 都从 container 里移除，再按 newOrder 依次插回 container
    //   （这样做最简单，当然也可以做更细的 insertBefore）
    sameLevelRows.forEach(r => container.removeChild(r));
    // 这里要找到插入位置：插回到 startIndex 之前
    // container 里实际上还有其他行（可能是上级），我们要将 newOrder 插入到 container.children 中的第 idx = startIndex 处
    // 但 startIndex 是在 allRows 中的索引，需要计算在 container.children 里的对应位置
    // 简化做法：我们直接让它们插到 rowIndex 原先位置也行
    // 但 rowIndex 在 allRows 是全局索引，容器当前 children 结构已经发生变化，需要重新找一下

    // 我们可这么做：找一下 allRows[startIndex] 在 container.children 里的位置:
    let anchor = null;
    if (startIndex < allRows.length) {
        anchor = allRows[startIndex];
    }
    // 如果 anchor 不在 DOM 了(被移除)，我们就找它的前一个还在 DOM 的兄弟
    while (anchor && !anchor.parentNode) {
        const anchorIndex = allRows.indexOf(anchor);
        if (anchorIndex > 0) {
            anchor = allRows[anchorIndex - 1];
        } else {
            // 说明已经到头了
            anchor = null;
            break;
        }
    }

    // 现在 anchor 若有效，就在 anchor 之后插入，否则直接 append
    newOrder.forEach(r => {
        if (anchor && anchor.parentNode === container) {
            container.insertBefore(r, anchor.nextSibling);
            anchor = r; // 让下一个插在当前插入行后面
        } else {
            container.appendChild(r);
            anchor = r;
        }
    });
}


/**
 * 遍历右侧树形面板中所有 tree-row 元素，
 * 如果 tree-row 的 data-mesh-name 与当前选中 Mesh 的 name 匹配，则高亮显示该行（例如设置背景色）。
 */
function updateTreeSelection() {
    const treeRows = document.querySelectorAll('.tree-row');
    treeRows.forEach(row => {
        // 若当前有选中 Mesh 且名称匹配，则添加高亮样式
        if (selectedMesh && row.dataset.meshName === selectedMesh.name) {
            row.style.backgroundColor = '#ffd966';  // 例如浅黄色背景
            row.style.border = '1px solid #f1c232';
            // 调用移动函数，把它移到同级最前
            moveRowToTopWithinSameParent(row);
            // 自动滚动到可视区域
            row.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        } else {
            // 否则清除样式
            row.style.backgroundColor = '';
            row.style.border = '';
        }
    });
}

/**
 * 当点击“Show Connection”按钮时：
 *  1) 找到该对象对应的 Mesh
 *  2) 从 connectionData 中找到所有与之有连接关系的对象
 *  3) 高亮自己 & 这些对象
 *  4) 让其他对象变淡
 */
function onShowConnectionFor(objName) {
    // 先从 scene 中找 objName 对应 Mesh
    const baseMesh = objectsByName[objName];
    if (!baseMesh || !baseMesh.isMesh) {
        alert(`No mesh found for: ${objName}`);
        return;
    }

    // 找到所有与之连接的 Mesh
    const connectedMeshes = findConnectedMeshes(baseMesh);

    // 更新 global state
    currentConnectionHighlight = {
        baseMesh,
        connectedMeshes,
        allHighlighted: true
    };

    // 执行“变淡+加亮”
    setHighlightWithFade(baseMesh, connectedMeshes);
}

/**
 * 找到与某个 mesh 有连接关系的所有对象
 */
function findConnectedMeshes(mesh) {
    if (!mesh || !mesh.name) return [];
    const meshName = mesh.name;
    const result = [];

    // 遍历 connectionData
    connectionData.data.forEach((connItem) => {
        // connItem 形如 { "Seat":"<Seat>...", "Base":"<Leg_Front_Left>..." }
        // 取 key => val
        const keys = Object.keys(connItem);
        if (keys.length < 2) return;
        const aKey = keys[0];
        const bKey = keys[1];
        const aStr = connItem[aKey];
        const bStr = connItem[bKey];
        // 解析
        const aConn = Utils.parseConnectionString(aStr);
        const bConn = Utils.parseConnectionString(bStr);

        // 如果 aConn.name === meshName，则 bConn.name 就是它的对端
        if (aConn.name === meshName) {
            const otherMesh = objectsByName[bConn.name];
            if (otherMesh && otherMesh.isMesh) {
                if (!result.includes(otherMesh)) {
                    result.push(otherMesh);
                }
            }
        }
        // 反之如果 bConn.name === meshName，则 aConn.name 是对端
        else if (bConn.name === meshName) {
            const otherMesh = objectsByName[aConn.name];
            if (otherMesh && otherMesh.isMesh) {
                if (!result.includes(otherMesh)) {
                    result.push(otherMesh);
                }
            }
        }
    });

    return result;
}

// --------------------------------------------------------------------------------------------
// 2) 扩充高亮逻辑：
//    setHighlightWithFade(baseMesh, connectedMeshes)
//    => 把 scene 中所有 Mesh 都先变淡，再把 baseMesh + connectedMeshes 恢复亮度/高亮
// --------------------------------------------------------------------------------------------
function setHighlightWithFade(baseMesh, connectedMeshes) {
    // 收集所有 Mesh
    const allMeshes = [];
    currentFurnitureRoot.traverse(obj => {
        if (obj.isMesh) allMeshes.push(obj);
    });

    // 1) 通通先变淡
    allMeshes.forEach(m => {
        fadeMesh(m, 0.1); // 0.1不透明
    });

    // 2) baseMesh + connectedMeshes 高亮
    highlightMeshWithStrongerColor(baseMesh);
    connectedMeshes.forEach(m => highlightMeshWithStrongerColor(m));
}

/**
 * 将某个mesh变淡(低不透明度)
 */
function fadeMesh(mesh, opacityVal = 0.1) {
    // 记录/恢复用
    if (!originalMaterialMap.has(mesh)) {
        originalMaterialMap.set(mesh, {
            material: mesh.material,
            isDimmed: false,
            isHighlighted: false
        });
    }

    // 若原材质是数组，需要逐个改
    if (Array.isArray(mesh.material)) {
        mesh.material.forEach(mat => {
            mat.transparent = true;
            mat.opacity = opacityVal;
            mat.depthTest = true; // 允许深度测试
        });
    } else {
        mesh.material.transparent = true;
        mesh.material.opacity = opacityVal;
        mesh.material.depthTest = true;
    }

    mesh.renderOrder = 0;

    // 如果之前加了 edges，要移除；否则会依然显示边线
    if (mesh.userData.highlightEdges) {
        mesh.remove(mesh.userData.highlightEdges);
        mesh.userData.highlightEdges.geometry.dispose();
        mesh.userData.highlightEdges = null;
    }

    const record = originalMaterialMap.get(mesh);
    record.isDimmed = true;
    record.isHighlighted = false;
}

/**
 * 高亮 mesh: 更高不透明度+渲染在前+Edges(可选)
 */
function highlightMeshWithStrongerColor(mesh) {
    // 先恢复到正常不透明
    if (Array.isArray(mesh.material)) {
        mesh.material.forEach(mat => {
            mat.transparent = true;
            mat.opacity = 1.0;
            mat.depthTest = false;  // 不参与深度测试 => 永远在前
        });
    } else {
        mesh.material.transparent = true;
        mesh.material.opacity = 1.0;
        mesh.material.depthTest = false;
    }
    mesh.renderOrder = 9999;

    const edgesGeo = new THREE.EdgesGeometry(mesh.geometry);
    const edgesMat = new THREE.LineBasicMaterial({
        color: 0xffff00,
        linewidth: 2,
        depthTest: false
    });
    const edges = new THREE.LineSegments(edgesGeo, edgesMat);
    edges.renderOrder = 10000;
    mesh.add(edges);
    mesh.userData.highlightEdges = edges;

    // 记录
    if (!originalMaterialMap.has(mesh)) {
        originalMaterialMap.set(mesh, {
            material: mesh.material,
            isDimmed: false,
            isHighlighted: true
        });
    } else {
        const rec = originalMaterialMap.get(mesh);
        rec.isDimmed = false;
        rec.isHighlighted = true;
    }
}


/**
 * 从 connectionData.data 中删除所有引用到某个 meshName 的连接条目
 * @param {string} meshName 
 */
function removeAllConnectionsOfMesh(meshName) {
    // 过滤掉凡是包含 meshName 的条目
    connectionData.data = connectionData.data.filter(connItem => {
        const keys = Object.keys(connItem);
        if (keys.length < 2) return true; // 容错：不符合预期结构就保留

        const firstStr = connItem[keys[0]];
        const secondStr = connItem[keys[1]];

        const cA = Utils.parseConnectionString(firstStr);
        const cB = Utils.parseConnectionString(secondStr);

        // 若此连接条目中，包含了被删除的 meshName，则跳过（不保留）
        if (cA.name === meshName || cB.name === meshName) {
            return false;
        }
        return true;
    });
}

/**
 * 删除操作：从 parentMeta.children 中移除指定 childMeta
 */
function removeChildMeta(parentMeta, childMeta) {
    if (!parentMeta.children) return;

    // 查找时同时支持包装对象和纯 meta 对象
    const idx = parentMeta.children.findIndex(c => {
        if (c.meta) {
            return c.meta === childMeta;
        } else {
            return c === childMeta;
        }
    });
    // 在 parentMeta.children 中找到 childMeta 对应的 index
    // const idx = parentMeta.children.findIndex(c => c.meta === childMeta);
    if (idx >= 0) {
        // 1) 先收集整个子树包含的所有 mesh 名称
        // console.log()
        // 如果 childMeta 包装了 meta，则取 c.meta，否则直接用 childMeta  
        const metaToRemove = childMeta.meta ? childMeta.meta : childMeta;
        const removedNames = Utils.collectAllMeshNames(metaToRemove);

        // 2) 从 parentMeta.children 中删除这个节点
        parentMeta.children.splice(idx, 1);

        // 3) 在 connectionData 中，删除所有引用到这些名称的连接
        removedNames.forEach(name => {
            removeAllConnectionsOfMesh(name);
        });

        // 4) 重新渲染
        render_furniture(furnitureData, connectionData);
        renderTreePanel();
    }
}

function promptAddChild(parentMeta) {
    // 先让用户选方式
    const choice = prompt(`Add child in 2 ways:
        1) copy from an existing mesh
        2) create a new mesh (default size)
        Please enter "1" or "2": `);
    if (!choice) return; // 用户取消
    if (choice !== "1" && choice !== "2") {
        alert("Invalid choice!");
        return;
    }

    if (choice === "1") {
        // ============ 方式1: 从现有某个mesh拷贝 ============
        copyFromExisting(parentMeta);
    } else {
        // ============ 方式2: 新建默认尺寸 ============
        createWithDefaultSize(parentMeta);
    }
}

function copyFromExisting(parentMeta) {
    // 让用户输入想复制的对象名称
    const sourceName = prompt('Please enter the name of an existing mesh to copy:');
    if (!sourceName) return;

    // 在 furnitureData 里找到对应meta (或者在 scene 中找到对应mesh 也行)
    const sourceMeta = Utils.findMetaByName(furnitureData.meta, sourceName);
    if (!sourceMeta) {
        alert("No meta found for: " + sourceName);
        return;
    }
    // 让用户输入新对象名称
    const newName = prompt('New Object Name for the copy:');
    if (!newName) return;

    // 复制
    // 这里仅示意：复制 object_type 和 dimensions
    // 如果要复制 children，也可进一步复制
    const newChild = {
        meta: {
            object: newName,
            object_type: sourceMeta.object_type,
            dimensions: {
                width: sourceMeta.dimensions?.width || 300,
                height: sourceMeta.dimensions?.height || 300,
                depth: sourceMeta.dimensions?.depth || 300
            }
        }
    };

    // 添加到 parentMeta.children
    if (!parentMeta.children) {
        parentMeta.children = [];
    }
    parentMeta.children.push(newChild);

    // 重新渲染
    render_furniture(furnitureData, connectionData);
    renderTreePanel();
}

function createWithDefaultSize(parentMeta) {
    const newName = prompt('New Object Name (e.g. "Back_Rest")');
    if (!newName) return;
    const newType = prompt('New Object Type (group / board / block / bar)', 'block');
    if (!newType) return;

    // 默认尺寸
    const DEFAULT_W = 300;
    const DEFAULT_H = 300;
    const DEFAULT_D = 300;

    // 构造一个新的 child
    const newChild = {
        meta: {
            object: newName,
            object_type: newType,
            dimensions: {
                width: DEFAULT_W,
                height: DEFAULT_H,
                depth: DEFAULT_D
            }
        }
    };

    if (!parentMeta.children) {
        parentMeta.children = [];
    }
    parentMeta.children.push(newChild);

    // 重新渲染
    render_furniture(furnitureData, connectionData);
    renderTreePanel();

    alert('Created a new child with default size 300x300x300!\nNow you can use "stretch mode" or the new keyboard scaling to adjust its dimensions.');
}


// 新增一个 createMarker 函数，使用小球做标记
function createMarker(radius = 10, color = 0xff0000) {
    const geometry = new THREE.SphereGeometry(radius, 16, 16);
    const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.7,
        depthTest: false
    });
    const sphere = new THREE.Mesh(geometry, material);
    // 让它渲染在最前
    sphere.renderOrder = 9999;
    return sphere;
}

// -------------- 新的：让单个 Mesh 高亮 --------------
function highlightSingleMesh(mesh) {
    // 1) 先遍历所有 mesh，让它们 opacity = 0.1(淡化)
    if (currentFurnitureRoot) {
        currentFurnitureRoot.traverse(obj => {
            if (obj.isMesh && obj !== mesh) {
                fadeMesh(obj, 0.1);
            }
        });
    }

    // 2) 自己 -> 强调
    highlightMeshWithStrongerColor(mesh);
}

function clearAllHighlight() {
    // 让场景中的所有 Mesh 变回正常 (opacity=1, depthTest=true, 移除 edges)
    if (!currentFurnitureRoot) return;
    currentFurnitureRoot.traverse(obj => {
        if (obj.isMesh) {
            // 恢复
            if (Array.isArray(obj.material)) {
                obj.material.forEach(m => {
                    m.transparent = true;
                    m.opacity = 1.0;
                    m.depthTest = true;
                });
            } else {
                obj.material.transparent = true;
                obj.material.opacity = 1.0;
                obj.material.depthTest = true;
            }
            obj.renderOrder = 0;

            // 如果之前给它加了 edges，也去掉
            if (obj.userData.highlightEdges) {
                obj.remove(obj.userData.highlightEdges);
                obj.userData.highlightEdges.geometry.dispose();
                obj.userData.highlightEdges = null;
            }
        }
    });

    // 若你需要的话，可以还原 selectedMesh = null
    selectedMesh = null;
    // 也把查看连接关系的状态清理掉
    currentConnectionHighlight = null;

    // 清除右侧树形面板中的高亮显示
    updateTreeSelection();


    // 如果 UI 里还显示 “Selected Mesh: ...”，也可清掉
    const displayDiv = document.getElementById('selectedMeshDisplay');
    if (displayDiv) {
        displayDiv.textContent = 'No mesh selected';
    }

    // ★ 关键点：重新渲染 ConnectionLog（此时 selectedMesh 为 null，列表不再高亮）
    renderConnectionLog();
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
// function clearSelectedMesh() {
//     if (selectedMesh) {
//         // 恢复 depthTest
//         if (Array.isArray(selectedMesh.material)) {
//             selectedMesh.material.forEach(m => {
//                 m.depthTest = true;
//             });
//         } else {
//             selectedMesh.material.depthTest = true;
//         }
//         selectedMesh.renderOrder = 0;

//         if (selectedEdges && selectedEdges.parent) {
//             selectedEdges.parent.remove(selectedEdges);
//             selectedEdges.geometry.dispose();
//         }
//     }
//     selectedMesh = null;
//     selectedEdges = null;

//     // 新增：恢复显示区域
//     const displayDiv = document.getElementById('selectedMeshDisplay');
//     if (displayDiv) {
//         displayDiv.textContent = "No mesh selected";
//     }
// }

// ============== selectMesh: 高亮新的 Mesh，取消之前的 ==============
function selectMesh(mesh) {
    // （1）先清除一切高亮
    clearAllHighlight();

    // （2）给这个 mesh 做“单选高亮”
    highlightSingleMesh(mesh);

    // （3）若需要记录“当前选中哪一个”，可以保留 selectedMesh = mesh
    //      这跟后续交互逻辑（如显示UI）有关
    selectedMesh = mesh;

    // （4）更新 UI 显示
    const displayDiv = document.getElementById('selectedMeshDisplay');
    if (displayDiv && mesh.name) {
        displayDiv.textContent = `Selected Mesh: ${mesh.name}`;
    }

    // ★★ 关键：每次选中 Mesh 后重新渲染连接面板 ★★
    renderConnectionLog();

    // ★ 新树形面板中选中行的样式
    updateTreeSelection();
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

    // mesh.userData.snapPoints = computeSnapPointsForBox(width, height, depth);
    // === 预先计算 8 个角点 ===
    mesh.userData.corners = Utils.computeBoxCorners(width, height, depth);

    // === 再计算 12 条边线段 ===
    mesh.userData.edges = Utils.computeBoxEdges(mesh.userData.corners);

    return mesh;
}

/**
 * 计算出一个方盒（width, height, depth）在本地坐标系的:
 *   - 8 个角点
 *   - 12 条边的中点
 * 返回: [{ pos: THREE.Vector3, type: 'corner'|'edgeMid' }, ...]
 */
function computeSnapPointsForBox(width, height, depth) {
    const w2 = width / 2;
    const h2 = height / 2;
    const d2 = depth / 2;

    let points = [];

    // 8 corners
    // x,y,z ∈ {±w2, ±h2, ±d2}
    // 共 8 组合
    let cornerSigns = [
        [+1, +1, +1],
        [+1, +1, -1],
        [+1, -1, +1],
        [+1, -1, -1],
        [-1, +1, +1],
        [-1, +1, -1],
        [-1, -1, +1],
        [-1, -1, -1],
    ];
    cornerSigns.forEach(signs => {
        let [sx, sy, sz] = signs;
        points.push({
            pos: new THREE.Vector3(sx * w2, sy * h2, sz * d2),
            type: 'corner'
        });
    });

    // 12 edges mid
    // 思路：一条边中有两个坐标是 ±，另一个坐标是 0
    // x-edge: y,z ∈ {±}, x=±w2, y= ±h2, z=±d2 ...
    // 简单做法：分别固定 axis= x / y / z
    //   - fix x=±w2, y=±h2, z=0
    //   - fix x=±w2, y=0, z=±d2
    //   - fix x=0, y=±h2, z=±d2
    // 这里可以手写也可以程序化遍历
    // 程序化遍历如下:
    //    edges X: x=±w2, y=±h2 or ±(-h2?), z=0 => 其实要 2*2=4 条?
    //    直接写完整更直观

    //  (±w/2, ±h/2, 0)
    let sign2D = [+1, -1];
    sign2D.forEach(sx => {
        sign2D.forEach(sy => {
            points.push({
                pos: new THREE.Vector3(sx * w2, sy * h2, 0),
                type: 'edgeMid'
            });
        });
    });

    // (±w/2, 0, ±d/2)
    sign2D.forEach(sx => {
        sign2D.forEach(sz => {
            points.push({
                pos: new THREE.Vector3(sx * w2, 0, sz * d2),
                type: 'edgeMid'
            });
        });
    });

    // (0, ±h/2, ±d/2)
    sign2D.forEach(sy => {
        sign2D.forEach(sz => {
            points.push({
                pos: new THREE.Vector3(0, sy * h2, sz * d2),
                type: 'edgeMid'
            });
        });
    });

    return points;
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
        // console.log("nowanchor:", anchor)
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
                // console.log("y:", y);
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
    else { // board or block
        return Utils.getFaceFractionAnchor(localPos, width, height, depth);
    }
}

/**
 * 1) 计算“已连接”对象的整体包围盒 (Box3)
 * 2) 将所有“无连接”对象，排在 x 轴正方向，从包围盒 + margin开始，依次排列。
 */
function scatterUnconnectedOutsideConnectedLine(rootObject, connectionData) {
    // -- 1) 先获取所有已连接对象的名称 --
    const connectedNames = new Set();
    if (connectionData && connectionData.data && Array.isArray(connectionData.data)) {
        for (const item of connectionData.data) {
            const keys = Object.keys(item);
            for (let k of keys) {
                const str = item[k] || "";
                const parsed = Utils.parseConnectionString(str);
                // 你已有的解析函数 => { name, type, anchors:[] }
                if (parsed.name) {
                    connectedNames.add(parsed.name);
                }
            }
        }
    }

    // -- 2) 计算已连接对象的世界坐标包围盒 --
    let connectedBox = new THREE.Box3();
    let hasConnected = false;

    rootObject.traverse(obj => {
        if (obj.isMesh && connectedNames.has(obj.name)) {
            obj.updateMatrixWorld(true);
            connectedBox.expandByObject(obj);
            hasConnected = true;
        }
    });

    // 若完全没有已连接对象 => 此时可选择不做排布或另外处理
    if (!hasConnected) {
        console.warn("No connected objects found. Skip line layout or do some fallback if needed.");
        return;
    }

    // 中心、尺寸
    const center = new THREE.Vector3();
    connectedBox.getCenter(center);
    const size = new THREE.Vector3();
    connectedBox.getSize(size);

    console.log("size:", size);

    // -- 3) 收集无连接对象 --
    const unconnected = [];
    rootObject.traverse(obj => {
        if (obj.isMesh && !connectedNames.has(obj.name)) {
            unconnected.push(obj);
        }
    });

    if (unconnected.length === 0) {
        return; // 没有无连接对象，直接结束
    }

    // -- 4) 在 x 轴外侧排布 --
    // 设定一个 margin，让它们起始位置在家具整体 xMax 的再往外 margin 的地方
    const margin = 400;
    // 已连接整体 X 最大值(中心 x + 一半宽度)
    const xMax = center.x + size.x / 2;
    // 两个无连接对象之间的间距
    const gap = center.x + size.x / 2; // 不用绝对数值因为家具的尺寸的单位不一定
    // 起始坐标
    let baseX = xMax + xMax;

    for (let i = 0; i < unconnected.length; i++) {
        const obj = unconnected[i];
        // console.log("obj:", obj)
        // 让它的 y、z 与已连接整体的中心保持一致
        const y = center.y;
        const z = center.z;

        const x = baseX + i * gap + ((i > 0) ? unconnected[i - 1].geometry.parameters.width / 2 : 0) + unconnected[i].geometry.parameters.width / 2;
        baseX += ((i > 0) ? unconnected[i - 1].geometry.parameters.width / 2 : 0) + unconnected[i].geometry.parameters.width / 2;

        // 设置位置
        obj.position.set(x, y, z);
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
    for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i];
        const keys = Object.keys(item); // 例如 ['Seat','Base']
        const firstKey = keys[0];
        const secondKey = keys[1];
        const firstStr = item[firstKey];
        const secondStr = item[secondKey];

        if (!firstStr || !secondStr || firstStr === "" || secondStr === "") {
            // 连接字符串不完整，删除该条目
            list.splice(i, 1);
            continue;
        }

        const firstConn = Utils.parseConnectionString(firstStr);
        const secondConn = Utils.parseConnectionString(secondStr);

        const firstObj = objectsByName[firstConn.name];
        const secondObj = objectsByName[secondConn.name];

        if (!firstObj || !secondObj) {
            console.warn('找不到对象:', firstConn.name, secondConn.name);
            // 删除这条连接关系
            list.splice(i, 1);
            continue;
        }

        // 计算它们的世界坐标 anchor
        // 先各自更新一次世界矩阵
        firstObj.updateMatrixWorld(true);
        secondObj.updateMatrixWorld(true);

        const firstLocalAnchor = calcLocalAnchorPosition(firstObj, firstConn.anchors);
        const firstWorldAnchor = firstObj.localToWorld(firstLocalAnchor.clone());

        const secondLocalAnchor = calcLocalAnchorPosition(secondObj, secondConn.anchors);
        const secondWorldAnchor = secondObj.localToWorld(secondLocalAnchor.clone());
        // console.log("anchor:", firstConn.anchors, "local:", firstLocalAnchor)
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
    }
}

const scene = new THREE.Scene();

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

    // 将无连接对象散布在 x 轴上，并放到“已连接整体”外
    scatterUnconnectedOutsideConnectedLine(currentFurnitureRoot, conn_data);

    renderConnectionLog();

    renderTreePanel();

    // 渲染完后清除上一轮“查看连接关系”模式
    clearAllHighlight();

    // ★★ 新增调用：检测并显示重叠 Mesh 的提示 ★★
    detectAndDisplayOverlap();


    return furniture_object;
}


// ======================
// 本地一开始就渲染一遍(初始状态) 线上环境等待外部传入json
// ======================
let furnitureData = JsonData;
let connectionData = ConnData;
let initialConnectionData;
let initialFurnitureData;

function handle_two_data() {
    connectionData = Utils.filterConnData(connectionData);
    // 引入 / 定义 furnitureData, connectionData 后，先进行尺寸放大
    scaleFurnitureIfTooSmall(furnitureData);
    // 拷贝一份初始状态

    initialFurnitureData = JSON.parse(JSON.stringify(furnitureData));
    initialConnectionData = JSON.parse(JSON.stringify(connectionData));
}

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
                handle_two_data()
                render_furniture(furnitureData, connectionData);
            }
        } catch (err) {
            console.error('message', event, err)
        }
    })
    window.parent.postMessage(JSON.stringify({ event: 'ready' }), '*')
} else {
    handle_two_data()
    render_furniture(furnitureData, connectionData);
}

// ===========================
// Three.js 初始化
// ===========================
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(
    75, // 视野(FOV)
    window.innerWidth / window.innerHeight, // 宽高比
    0.1, // 近裁剪面
    100000 // 远裁剪面
);
camera.position.set(0, 800, 1500);
camera.lookAt(0, 0, 0);

// const crossMarker = createCrossMarker(20, 0xff0000);
// scene.add(crossMarker);
// // 初始隐藏
// crossMarker.visible = false;
const snappingMarker = createMarker(10, 0xff0000);
scene.add(snappingMarker);
snappingMarker.visible = false;

// 从 furnitureData.meta.dimensions 中获取初始尺寸
const initDims = furnitureData.meta.dimensions;
// 计算最大尺寸
const maxDim = Math.max(initDims.width, initDims.height, initDims.depth);
// 根据最大尺寸乘以一个系数（比如1.5）得到轴长度
const axesLength = maxDim;
const axesHelper = new THREE.AxesHelper(axesLength / 2);
scene.add(axesHelper);
const dir_x = new THREE.Vector3(1, 0, 0);
const dir_y = new THREE.Vector3(0, 0, 1);
const dir_z = new THREE.Vector3(0, 1, 0);
//normalize the direction vector (convert to vector of length 1)
dir_x.normalize();
dir_y.normalize();
dir_z.normalize();
const origin = new THREE.Vector3(0, 0, 0);
const length = axesLength * 3;
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

function setMeshDimension(meshName, axis, newVal) {
    if (newVal < 1) newVal = 1; // 不允许小于1
    // 找到旧值
    const mesh = objectsByName[meshName];
    if (!mesh || !mesh.geometry?.parameters) return;
    const oldVal = mesh.geometry.parameters[axis];

    // 写入 dimensionChangeLog
    dimensionChangeLog.push({
        meshName: meshName,
        axis: axis,
        oldVal: oldVal,
        newVal: newVal
    });
    // 在 furnitureData.meta 里找到这个mesh的 meta 并更新
    updateDimensionAndOffsetInMeta(furnitureData.meta, meshName, axis, newVal);
    // 然后重新渲染
    render_furniture(furnitureData, connectionData);
    renderDimensionChangeLog(); // 刷新维度变更面板
}

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

// 定义数字到字符串的映射对象
const faceMapping = {
    0: "Right Face",
    1: "Right Face",
    2: "Left Face",
    3: "Left Face",
    4: "Top Face",
    5: "Top Face",
    6: "Bottom Face",
    7: "Bottom Face",
    8: "Front Face",
    9: "Front Face",
    10: "Back Face",
    11: "Back Face",
};

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
            const faceDescriptionA = faceMapping[stretchFaceIndexA] || "Unknown Face";
            text += `<div>Now you choose the object: ${stretchMeshA.name}.</div>`
            text += `<div>The Face you choose is (${faceDescriptionA})</div>`
            text += `<div>Please Choose the referece object.</div>`
        } else if (stretchState === 3) {
            const faceDescriptionA = faceMapping[stretchFaceIndexA] || "Unknown Face";
            text += `<div>Now you choose the object: ${stretchMeshA.name}.</div>`
            text += `<div>The Face you choose is (${faceDescriptionA})</div>`
            text += `<div>Please Choose the referece object ${stretchMeshB.name}, please choose a face on it.</div>`
        } else {
            const faceDescriptionA = faceMapping[stretchFaceIndexA] || "Unknown Face";
            // 如果第二个对象的面索引是 stretchFaceIndexB
            const faceDescriptionB = faceMapping[stretchFaceIndexB] || "Unknown Face";
            text += `<div>Now you choose the object: ${stretchMeshA.name}.</div>`
            text += `<div>The Face you choose is (${faceDescriptionA})</div>`
            text += `<div>Please Choose the referece object ${stretchMeshB.name}, please choose a face on it.</div>`
            text += `<div>The Face you choose on reference object is (${faceDescriptionB})</div>`
        }
    }

    infoDiv.innerHTML = text;
}

function changeConnectState() {
    currentMode = 'connect';
    clearAllHighlight();
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
    clearAllHighlight();
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
    const firstConn = Utils.parseConnectionString(connItem[firstKey] || '');
    const secondConn = Utils.parseConnectionString(connItem[secondKey] || '');
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
        // 创建一行
        const row = document.createElement('div');

        // 显示文字
        const textSpan = document.createElement('span');
        textSpan.textContent = `[${idx + 1}] Mesh "${record.meshName}" axis "${record.axis}" changed from ${record.oldVal.toFixed(2)} to ${record.newVal.toFixed(2)}`;
        row.appendChild(textSpan);

        // ★★★ 新增: 删除按钮 ★★★
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.style.marginLeft = '8px';
        removeBtn.addEventListener('click', () => {
            removeDimensionChangeLogItem(idx);
        });
        row.appendChild(removeBtn);

        container.appendChild(row);
    });
}

// ★★★ 新增：删除dimensionChangeLog里某一项，并恢复Meta数据 ★★★
function removeDimensionChangeLogItem(index) {
    const record = dimensionChangeLog[index];
    if (!record) return; // 防御

    // 1) 恢复此记录对应的oldVal
    updateDimensionAndOffsetInMeta(furnitureData.meta, record.meshName, record.axis, record.oldVal);

    // 2) 从数组中移除这条变更记录
    dimensionChangeLog.splice(index, 1);

    // 3) 重新渲染场景
    render_furniture(furnitureData, connectionData);

    // 4) 重新刷新日志面板
    renderDimensionChangeLog();
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
        // console.log("HERE11111")
        // 如果这一条连接与 selectedMeshName 有关，则加上高亮类
        if (selectedMeshName && connectionItemHasName(item, selectedMeshName)) {
            // console.log("HERE222222")
            itemDiv.classList.add('conn-item-highlight');
        }


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
    const conn = Utils.parseConnectionString(str);
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
    clearAllHighlight();
    updateInfo();
}

function resetStretchProcess() {
    stretchState = 0
    stretchMeshA = null;
    stretchFaceIndexA = -1;
    stretchMeshB = null;
    stretchFaceIndexB = -1;
    clearAllHighlight();
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

/**
 * 根据两个 meshName 删除 connectionData.data 里对应的那条连接关系
 * 注：可能一对 mesh 之间有多条连接，需要都删或只删一条？此处简单做“都删”
 */
function removeConnectionBetweenTwoMeshes(nameA, nameB) {
    const newData = [];
    connectionData.data.forEach(item => {
        const keys = Object.keys(item);
        if (keys.length < 2) {
            newData.push(item);
            return;
        }
        const aStr = item[keys[0]];
        const bStr = item[keys[1]];
        const cA = Utils.parseConnectionString(aStr);
        const cB = Utils.parseConnectionString(bStr);

        // 如果 cA.name/cB.name 刚好是一对 (nameA, nameB)，则跳过（不加到 newData）
        // 注意还有 (nameB, nameA) 也算
        const pairSet = new Set([cA.name, cB.name]);
        if (pairSet.has(nameA) && pairSet.has(nameB)) {
            // 跳过
        } else {
            newData.push(item);
        }
    });
    connectionData.data = newData;
}

// --------------------------------------------------------------------------------------------
// 4) 当我们点击别的物体或重新渲染时，应该清除“查看连接关系”模式
// --------------------------------------------------------------------------------------------
function clearConnectionHighlight() {
    // 恢复所有 mesh 的 depthTest / material.opacity = 1
    const allMeshes = [];
    currentFurnitureRoot.traverse(obj => {
        if (obj.isMesh) allMeshes.push(obj);
    });
    allMeshes.forEach(m => {
        // 恢复
        if (Array.isArray(m.material)) {
            m.material.forEach(mat => {
                mat.transparent = true;
                mat.opacity = 1.0;
                mat.depthTest = true;
            });
        } else {
            m.material.transparent = true;
            m.material.opacity = 1.0;
            m.material.depthTest = true;
        }
        m.renderOrder = 0;

        // 若之前加过 edges, 则移除
        if (m.userData.highlightEdges) {
            m.remove(m.userData.highlightEdges);
            m.userData.highlightEdges.geometry.dispose();
            m.userData.highlightEdges = null;
        }
    });

    currentConnectionHighlight = null;
}

/**
 * 显示标记球，并根据 snapType 设置颜色/大小
 * snapType: 'corner' | 'edge' | 'grid'
 */
function showSnappedMarker(mesh, localPos, snapType) {
    let color = 0xff0000; // red for grid
    let scaleFactor = 1.0;

    if (snapType === 'corner') {
        color = 0x00ff00;  // green
        scaleFactor = 1.5;
    } else if (snapType === 'edge') {
        color = 0x0000ff;  // blue
        scaleFactor = 1.2;
    }
    // 计算世界坐标
    const worldPos = mesh.localToWorld(localPos.clone());
    snappingMarker.position.copy(worldPos);
    snappingMarker.material.color.set(color);
    snappingMarker.scale.set(scaleFactor, scaleFactor, scaleFactor);
    snappingMarker.visible = true;
}

/**
 * 点到线段的最短距离 & 最近点
 * @param {THREE.Vector3} point 
 * @param {THREE.Vector3} start 
 * @param {THREE.Vector3} end 
 * @returns { dist: number, closestPoint: THREE.Vector3 }
 */
function pointToSegmentDistance(point, start, end) {
    // 线段向量
    const segVec = new THREE.Vector3().subVectors(end, start);
    // 点到 start 的向量
    const ptVec = new THREE.Vector3().subVectors(point, start);

    const segLenSq = segVec.lengthSq();
    if (segLenSq < 1e-8) {
        // degenerate edge
        return { dist: ptVec.length(), closestPoint: start.clone() };
    }
    // 投影系数 = (ptVec · segVec) / (segLenSq)
    let t = ptVec.dot(segVec) / segLenSq;
    // clamp t to [0,1]
    t = Math.max(0, Math.min(1, t));
    // 最近点 = start + t * segVec
    const closestPoint = start.clone().add(segVec.multiplyScalar(t));
    // 距离
    const dist = point.distanceTo(closestPoint);
    return { dist, closestPoint };
}

function setMeshDimensionNoLog(meshName, axis, newVal) {
    updateDimensionAndOffsetInMeta(furnitureData.meta, meshName, axis, newVal);
    render_furniture(furnitureData, connectionData);
}


function onPointerMove(event) {

    // 记录当前鼠标位置（方便 keydown 时用）
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;

    // 如果处于拉伸状态，则实时更新尺寸
    if (scalingAxis !== null && scalingMeshName) {
        const mesh = objectsByName[scalingMeshName];
        if (!mesh) return;

        // 假设 1 像素 = 1 mm（可根据需要加缩放系数 如下）
        const scaleFactor = 1; // 表示鼠标移动1px => 1mm
        let delta = 0;
        if (scalingAxis === 'width') {
            // left/right 移动 => 取 dx
            const dx = event.clientX - scalingStartMouseX;
            delta = dx; // 正负决定增/减
        } else if (scalingAxis === 'height') {
            // up/down 移动 => 取 dy
            // 由于屏幕坐标是从上往下增大，所以想要“鼠标向上 => 数值变大”，要反过来减一下
            const dy = scalingStartMouseY - event.clientY;
            delta = dy;
        } else if (scalingAxis === 'depth') {
            // 决定用 dx 或 dy —— 此处决定同 width 一样 用 dx
            const dx = event.clientX - scalingStartMouseX;
            delta = dx;
        }


        let newVal = scalingStartDim + delta * scaleFactor;
        if (newVal < 1) newVal = 1; // // 避免变成0或负值
        setMeshDimensionNoLog(scalingMeshName, scalingAxis, newVal);
        // 在拉伸状态下，不执行其他逻辑
    }

    // 如果不是“连接模式”，就隐藏标记，返回
    if (currentMode !== 'connect') {
        snappingMarker.visible = false;
        tempSnappedLocalPos = null;
        tempSnappedMesh = null;
        return;
    }

    // 根据 connectState 的不同，来决定是否显示球标记
    // connectState 各阶段含义：
    //   0 -> 尚未选第一物体
    //   1 -> 已选第一物体，正在选择第一物体的锚点
    //   2 -> 已选第一物体&其锚点，准备选第二物体
    //   3 -> 已选第二物体，正在选择第二物体的锚点
    //   (4 -> 已选完第二物体&其锚点，就要执行连接)

    // 只有在 connectState=1 时，我们让用户在 firstMesh 上选锚点
    //    在 connectState=3 时，我们让用户在 secondMesh 上选锚点
    // 其余阶段都不显示球
    if (connectState !== 1 && connectState !== 3) {
        snappingMarker.visible = false;
        tempSnappedLocalPos = null;
        tempSnappedMesh = null;
        return;
    }

    // 如果是 connectState=1，就说明要在 firstMesh 上选点
    // 如果是 connectState=3，就说明要在 secondMesh 上选点
    // 所以要知道当前需要的“目标 Mesh”是哪一个
    let targetMesh = null;
    if (connectState === 1 && firstMesh) {
        targetMesh = firstMesh;
    }
    else if (connectState === 3 && secondMesh) {
        targetMesh = secondMesh;
    } else {
        snappingMarker.visible = false;
        tempSnappedLocalPos = null;
        tempSnappedMesh = null;
        return;
    }

    // 转换鼠标坐标到标准化设备坐标(-1 ~ +1)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
        // const hit = intersects[0];
        // const hitObject = hit.object;
        // const hitPointWorld = hit.point.clone();
        const hit = intersects.find(item => item.object === targetMesh);

        if (!hit) {
            snappingMarker.visible = false;
            tempSnappedLocalPos = null;
            tempSnappedMesh = null;
            return;
        }

        // 命中了 targetMesh => 计算局部坐标
        let localPos = targetMesh.worldToLocal(hit.point.clone());




        // =============== 1) Corner 吸附检测 ===============
        const CORNER_THRESHOLD = 30;  // mm
        let bestCornerDist = Infinity;
        let bestCornerPos = null;
        const corners = targetMesh.userData.corners || [];
        for (let c of corners) {
            const dist = localPos.distanceTo(c);
            if (dist < bestCornerDist) {
                bestCornerDist = dist;
                bestCornerPos = c;
            }
        }
        if (bestCornerDist < CORNER_THRESHOLD) {
            // 如果最近角点在阈值范围内，吸附到角点
            showSnappedMarker(targetMesh, bestCornerPos, 'corner');
            tempSnappedLocalPos = bestCornerPos.clone();
            tempSnappedMesh = targetMesh;
            return; // 直接结束，不再检查边/网格
        }

        // =============== 2) Edge 吸附检测 ===============
        // 目标：找最近的“线段上投影点” + 距离
        // 如果距离 < 阈值 => 吸附到那条边
        const EDGE_THRESHOLD = 30;  // mm
        let bestEdgeDist = Infinity;
        let bestEdgePoint = null;
        const edges = targetMesh.userData.edges || [];
        for (let e of edges) {
            // 最近点 = 点对线段投影
            const { closestPoint, dist } = pointToSegmentDistance(localPos, e.start, e.end);
            if (dist < bestEdgeDist) {
                bestEdgeDist = dist;
                bestEdgePoint = closestPoint;
            }
        }
        if (bestEdgeDist < EDGE_THRESHOLD) {
            // 吸附到该边最近点
            showSnappedMarker(targetMesh, bestEdgePoint, 'edge');
            tempSnappedLocalPos = bestEdgePoint.clone();
            tempSnappedMesh = targetMesh;
            return; // 结束，不再检查网格
        }

        // =============== 3) 50mm 网格吸附 ===============
        // 如果不在 corner / edge 的范围，就做原先的 50mm 吸附
        localPos.x = SNAP_STEP * Math.round(localPos.x / SNAP_STEP);
        localPos.y = SNAP_STEP * Math.round(localPos.y / SNAP_STEP);
        localPos.z = SNAP_STEP * Math.round(localPos.z / SNAP_STEP);
        showSnappedMarker(targetMesh, localPos, 'grid');
        tempSnappedLocalPos = localPos.clone();
        tempSnappedMesh = targetMesh;
    } else {
        // 没有命中任何对象，就隐藏
        snappingMarker.visible = false;
        tempSnappedLocalPos = null;
        tempSnappedMesh = null;
    }
}

/**
 * 让 meshA 的 faceIndexA 这面，移动过去对齐 meshB 的 faceIndexB；
 * 效果：meshA 只在那一面进行伸缩，A的对侧面保持在原世界坐标不动。
 */
function doStretchAlignFaceAtoFaceB(meshA, faceIndexA, meshB, faceIndexB) {
    // console.log("test:", faceIndexA, faceIndexB);
    function getFaceCenterWorld(mesh, rawFaceIndex, eor = false) {
        const { axis, sign } = Utils.getFaceAxisAndSign(mesh, rawFaceIndex, eor);
        const half = mesh.geometry.parameters[axis] * 0.5;
        let centerLocal = new THREE.Vector3(0, 0, 0);
        if (axis === 'width') centerLocal.x = sign * half;
        if (axis === 'height') centerLocal.y = sign * half;
        if (axis === 'depth') centerLocal.z = sign * half;
        return mesh.localToWorld(centerLocal.clone());
    }

    // 1) 识别 A 的面对应的轴 + 正负号
    //    注意你已有的 getFaceAxisAndSign(mesh, faceIndex) 函数
    const { axis: axisA, sign: signA } = Utils.getFaceAxisAndSign(meshA, faceIndexA);

    // 如果取不到 axis，说明 faceIndex 有误
    if (!axisA) {
        console.warn('Cannot detect axis from faceIndexA, skip');
        return;
    }

    // 2) 在世界坐标下，拿到 A 的 [chosen 面] 与 [anchor 面] 的中心
    //    chosen 面 = faceIndexA
    //    anchor 面 = faceIndexA ^ 1 (对侧面)
    const chosenFaceCenter_before = getFaceCenterWorld(meshA, faceIndexA);
    const anchorFaceCenter_before = getFaceCenterWorld(meshA, faceIndexA, true);

    // 3) B 的那面中心
    const targetFaceCenter = getFaceCenterWorld(meshB, faceIndexB);

    // 4) oldVal = A 在 axisA 方向的现有长度
    const oldVal = meshA.geometry.parameters[axisA];

    // 5) 计算 newVal:
    //    核心思路：anchor 点保持不动 -> chosen 面移动到 target
    //    => newVal = distance( anchorFaceCenter_before → targetFaceCenter ) 在 axisA 方向上的分量
    //    具体要考虑 signA(如果 chosen 面是 + 号那侧，计算 delta = (target - anchor).dot(axisDirection)；
    //    如果是 - 号那侧，也可加以区分，但常用绝对值来保证长度是正。

    // 这里假设场景没旋转或都对齐，仅需看 x/y/z 分量
    // 如果有任意旋转，需要更复杂的 localAxis 变换，这里先简化处理
    let deltaVec = new THREE.Vector3().subVectors(targetFaceCenter, chosenFaceCenter_before);
    let axisDir = new THREE.Vector3(0, 0, 0);
    if (axisA === 'width') axisDir.set(1, 0, 0);   // x
    if (axisA === 'height') axisDir.set(0, 1, 0);   // y
    if (axisA === 'depth') axisDir.set(0, 0, 1);   // z

    // dot 可以得出在 axisDir 上的投影长度
    let delta = deltaVec.dot(axisDir);
    // console.log("delta:", delta);
    // 最终长度
    let newVal = oldVal + (delta * signA);  // signA 通常是 +1 或 -1
    if (newVal < 1) {
        newVal = 1; // 做个最小值限制，避免出现负数或太小
    }
    // console.log("newval:", newVal);

    // 6) 更新 geometry.parameters[axisA] 并刷新 furnitureData 里的值
    updateDimensionAndOffsetInMeta(furnitureData.meta, meshA.name, axisA, newVal);

    // 7) 重新渲染一次，让 meshA 几何尺寸更新
    //    注意：render_furniture(...) 会 recreate Mesh，所以需要先记录 anchorFaceCenter_before
    //    再 render 后，需要再拿到新的 meshA
    // console.log("before:", objectsByName[meshA.name]);
    render_furniture(furnitureData, connectionData);


    // 现在，从 objectsByName 里重新获取新的 meshA
    const newMeshA = objectsByName[meshA.name];

    // console.log("after:", objectsByName[meshA.name]);
    if (!newMeshA) return;

    newMeshA.updateMatrixWorld(true);

    // 8) 现在 newMeshA 具有新的尺寸，但它的 center 依然在(0,0,0)；chosen/anchor 都会一起移动
    //    => 我们要把 anchor 面移回原先 anchorFaceCenter_before
    //    => 先计算 anchor 面 (faceIndexA ^ 1) 在此刻新的世界坐标 anchorFaceCenter_after
    const anchorFaceCenter_after = getFaceCenterWorld(newMeshA, faceIndexA, true);
    // console.log("index:", faceIndexA, faceIndexA ^ 1);
    // console.log("newmeshA:", newMeshA);
    // console.log("before:", anchorFaceCenter_before);
    // console.log("after:", anchorFaceCenter_after);

    let offset = delta.clone()
    // console.log("offset:", offset);
    offset.divideScalar(2);
    // 让 newMeshA 整体平移
    newMeshA.position.add(offset);

    // 记录到 dimensionChangeLog
    dimensionChangeLog.push({
        meshName: newMeshA.name,
        axis: axisA,
        oldVal: oldVal,
        newVal: newVal
    });
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

    if (currentConnectionHighlight && currentConnectionHighlight.allHighlighted) {
        if (intersects.length > 0) {
            const hit = intersects[0];
            const hitObject = hit.object;
            // 如果点到了“连接对端” => 提示是否要删除
            if (currentConnectionHighlight.connectedMeshes.includes(hitObject)) {
                // 弹出提示
                const yes = confirm(
                    `Do you want to remove connection between "${currentConnectionHighlight.baseMesh.name}" and "${hitObject.name}"?`
                );
                if (yes) {
                    removeConnectionBetweenTwoMeshes(currentConnectionHighlight.baseMesh.name, hitObject.name);
                    // 重新渲染 + 重置高亮
                    render_furniture(furnitureData, connectionData);
                    clearConnectionHighlight();
                }
            }
        }
    }

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
                if (!tempSnappedLocalPos || tempSnappedMesh !== firstMesh) {
                    // 取消选中 & 重置
                    resetConnectProcess();
                } else {
                    // 点到 firstMesh => 这是 anchor
                    // const hitPoint = hit.point.clone();
                    // // 吸附
                    // let localPos = firstMesh.worldToLocal(hitPoint);

                    const localPos = tempSnappedLocalPos.clone();
                    firstAnchor.copy(firstMesh.localToWorld(localPos.clone()));
                    firstAnchorStr = getAnchorDescription(firstMesh, localPos); //这个函数有问题
                    firstMeshType = Utils.getObjectType({ width: firstMesh.geometry.parameters.width, height: firstMesh.geometry.parameters.height, depth: firstMesh.geometry.parameters.depth })

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
                    clearAllHighlight();
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
                if (!tempSnappedLocalPos || tempSnappedMesh !== secondMesh) {
                    resetConnectProcess();
                } else {
                    // 点到 secondMesh => anchor
                    // const hitPoint = hit.point.clone();
                    // let localPos = secondMesh.worldToLocal(hitPoint);

                    const localPos = tempSnappedLocalPos.clone();
                    secondAnchor.copy(secondMesh.localToWorld(localPos.clone()));

                    let secondAnchorStr = getAnchorDescription(secondMesh, localPos);
                    let secondMeshType = Utils.getObjectType({ width: secondMesh.geometry.parameters.width, height: secondMesh.geometry.parameters.height, depth: secondMesh.geometry.parameters.depth })


                    const firstConnStr = `<${firstMesh.name}><${firstMeshType}>[${firstAnchorStr}]`
                    const secondConnStr = `<${secondMesh.name}><${secondMeshType}>[${secondAnchorStr}]`

                    // 获取lowest siblings name
                    const { keyA, keyB } = findSiblingKeysFor(firstMesh.name, secondMesh.name);
                    console.log("FirstMesh:", firstMesh, "SecondMesh:", secondMesh, "keyA:", keyA, "keyB:", keyB);

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

                    clearAllHighlight();
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
                            clearAllHighlight();
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
                            resetStretchProcess();
                        } else {
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
                            clearAllHighlight();
                            updateInfo();
                        }
                    } else {
                        resetStretchProcess()
                    }
                }
            }
        }
    }

    // 最后，如果既不在 connect 或 stretch 中间步骤，也没点到任何对象 => 清除所有高亮
    // 先判断 intersects.length === 0 => 说明点空白
    if (intersects.length === 0) {
        // 再判断是否不在 connect / stretch 的选择中
        // 这里要看你的逻辑：当 connectState=0 / stretchState=0 才算空闲？
        // 简单做法：只要 connectState===0 && stretchState===0 就清理

        if (connectState === 0 && stretchState === 0) {
            clearAllHighlight();
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
        changeConnectState();
    } else if (event.key === 'T' || event.key === 't') {
        changeStretchState()
    }
    else {
        const key = event.key.toLowerCase();
        if (['x', 'y', 'z'].includes(key)) {
            // 必须已经选中了某个 Mesh，否则不操作
            if (!selectedMesh) return;
            // 如果已经在进行拉伸操作，忽略重复触发
            if (scalingAxis) return;
            let axis = null;
            if (key === 'x') axis = 'width';
            if (key === 'y') axis = 'height';
            if (key === 'z') axis = 'depth';

            // 如果不是 x/y/z，则不处理
            if (!axis) return;
            scalingAxis = key === 'x' ? 'width' : key === 'y' ? 'height' : 'depth';

            // 判断选中对象是否有 BoxGeometry
            const geom = selectedMesh.geometry;
            if (!geom || !geom.parameters) {
                console.warn('Selected object is not a Mesh with BoxGeometry; cannot scale by axis.');
                return;
            }
            // 记录状态
            scalingAxis = axis;
            scalingStartDim = geom.parameters[axis];  // 该轴当前尺寸
            scalingStartMouseX = lastMouseX;
            scalingStartMouseY = lastMouseY;       // 记下当前鼠标X
            scalingMeshName = selectedMesh.name;      // 记录 mesh 名
        }
    }
}

function onKeyUp(event) {
    // 若当前并未处于缩放状态，或按的键并不是 x/y/z，就不做事
    if (!scalingAxis) return;

    const key = event.key.toLowerCase();
    if (key !== 'x' && key !== 'y' && key !== 'z') {
        return;
    }
    // 只有当松开的键与 scalingAxis 对应时，才结束
    // 比如 scalingAxis='width' 对应 'x'
    if ((scalingAxis === 'width' && key === 'x') ||
        (scalingAxis === 'height' && key === 'y') ||
        (scalingAxis === 'depth' && key === 'z')) {

        // 在此时可以做一次「最终尺寸」的变更日志记录
        const mesh = objectsByName[scalingMeshName];
        if (mesh && mesh.geometry && mesh.geometry.parameters) {
            const finalDim = mesh.geometry.parameters[scalingAxis];
            // 写日志
            dimensionChangeLog.push({
                meshName: scalingMeshName,
                axis: scalingAxis,
                oldVal: scalingStartDim,   // 初始大小
                newVal: finalDim          // 最终大小
            });
            renderDimensionChangeLog();
        }

        // 结束缩放状态
        scalingAxis = null;
        scalingMeshName = null;
        scalingStartDim = 0;
        scalingStartMouseX = 0;
        scalingStartMouseY = 0;
    }
}

window.addEventListener('mousedown', onPointerDown, false);
window.addEventListener('mousemove', onPointerMove, false);
window.addEventListener('mouseup', onPointerUp, false);
window.addEventListener('keydown', switchmode, false);
window.addEventListener('keyup', onKeyUp, false);

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

        const cA = Utils.parseConnectionString(firstStr);
        const cB = Utils.parseConnectionString(secondStr);

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
                const { keyA, keyB } = findSiblingKeysFor(meshA.name, meshB.name);
                // const keyA = meshA.name
                // const keyB = meshB.name
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
    // render_furniture(furnitureData, connectionData);
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

const resetBtn = document.getElementById('resetBtn');
resetBtn.addEventListener('click', () => {
    // 1) 恢复为初始数据
    furnitureData = JSON.parse(JSON.stringify(initialFurnitureData));
    connectionData = JSON.parse(JSON.stringify(initialConnectionData));

    // 2) 清空日志 / 编辑状态 / 交互状态
    dimensionChangeLog = [];     // 若你有其他变动日志，也可清空
    editingConnections.clear();  // 编辑连接的临时Map

    // 根据你自己的逻辑，若有 connectMode / stretchMode 等，需要重置一下
    currentMode = 'connect';
    resetConnectProcess();
    resetStretchProcess();
    clearAllHighlight();

    // 3) 重新渲染
    render_furniture(furnitureData, connectionData);
    renderTreePanel();

    console.log('Reset to initial state done!');
});


// 新增：辅助函数 AnchorNameIsCorner
// 根据 Mesh 的尺寸和当前面类型，采用相对阈值进一步细化 anchor 名称
function AnchorNameIsCorner(originalAnchor, mesh, contactPoint) {
    // 如果没有几何参数，则直接返回原始 anchor
    if (!mesh.geometry || !mesh.geometry.parameters) return `<${originalAnchor}>`;;
    const { width, height, depth } = mesh.geometry.parameters;
    // 将世界坐标 contactPoint 转换为 mesh 的局部坐标
    const contactlocalPoint = mesh.worldToLocal(contactPoint.clone());
    console.log("mesh", mesh);
    console.log("orianchor:", originalAnchor);
    console.log("lllllocalpoint", contactlocalPoint);

    // 设置一个相对阈值因子，比如 0.2 表示 20%
    const factor = 0.2;

    // 根据原始 anchor 判断当前是哪一侧的 face，从而确定候选角点和面相关尺寸
    let faceCandidates = {};
    let faceDimension = 0; // 用于计算阈值

    if (originalAnchor.includes("BottomFace")) {
        // BottomFace 对应 y = -height/2，其候选角点在 x-z 平面
        faceCandidates = {
            "FrontLeftCorner": new THREE.Vector3(-width / 2, -height / 2, depth / 2),
            "FrontRightCorner": new THREE.Vector3(width / 2, -height / 2, depth / 2),
            "BackLeftCorner": new THREE.Vector3(-width / 2, -height / 2, -depth / 2),
            "BackRightCorner": new THREE.Vector3(width / 2, -height / 2, -depth / 2)
        };
        faceDimension = Math.min(width, depth);
    } else if (originalAnchor.includes("TopFace")) {
        // TopFace 对应 y = +height/2，其候选角点在 x-z 平面
        faceCandidates = {
            "FrontLeftCorner": new THREE.Vector3(-width / 2, height / 2, depth / 2),
            "FrontRightCorner": new THREE.Vector3(width / 2, height / 2, depth / 2),
            "BackLeftCorner": new THREE.Vector3(-width / 2, height / 2, -depth / 2),
            "BackRightCorner": new THREE.Vector3(width / 2, height / 2, -depth / 2)
        };
        faceDimension = Math.min(width, depth);
    } else if (originalAnchor.includes("LeftFace")) {
        // LeftFace 对应 x = -width/2，其候选角点在 y-z 平面
        faceCandidates = {
            "TopFrontCorner": new THREE.Vector3(-width / 2, height / 2, depth / 2),
            "TopBackCorner": new THREE.Vector3(-width / 2, height / 2, -depth / 2),
            "BottomFrontCorner": new THREE.Vector3(-width / 2, -height / 2, depth / 2),
            "BottomBackCorner": new THREE.Vector3(-width / 2, -height / 2, -depth / 2)
        };
        faceDimension = Math.min(height, depth);
    } else if (originalAnchor.includes("RightFace")) {
        // RightFace 对应 x = +width/2，其候选角点在 y-z 平面
        faceCandidates = {
            "TopFrontCorner": new THREE.Vector3(width / 2, height / 2, depth / 2),
            "TopBackCorner": new THREE.Vector3(width / 2, height / 2, -depth / 2),
            "BottomFrontCorner": new THREE.Vector3(width / 2, -height / 2, depth / 2),
            "BottomBackCorner": new THREE.Vector3(width / 2, -height / 2, -depth / 2)
        };
        faceDimension = Math.min(height, depth);
    } else if (originalAnchor.includes("FrontFace")) {
        // FrontFace 对应 z = +depth/2，其候选角点在 x-y 平面
        faceCandidates = {
            "TopLeftCorner": new THREE.Vector3(-width / 2, height / 2, depth / 2),
            "TopRightCorner": new THREE.Vector3(width / 2, height / 2, depth / 2),
            "BottomLeftCorner": new THREE.Vector3(-width / 2, -height / 2, depth / 2),
            "BottomRightCorner": new THREE.Vector3(width / 2, -height / 2, depth / 2)
        };
        faceDimension = Math.min(width, height);
    } else if (originalAnchor.includes("BackFace")) {
        // BackFace 对应 z = -depth/2，其候选角点在 x-y 平面
        faceCandidates = {
            "TopLeftCorner": new THREE.Vector3(-width / 2, height / 2, -depth / 2),
            "TopRightCorner": new THREE.Vector3(width / 2, height / 2, -depth / 2),
            "BottomLeftCorner": new THREE.Vector3(-width / 2, -height / 2, -depth / 2),
            "BottomRightCorner": new THREE.Vector3(width / 2, -height / 2, -depth / 2)
        };
        faceDimension = Math.min(width, height);
    } else {
        // 其他情况不处理，直接返回原始 anchor
        return `<${originalAnchor}>`;
    }
    console.log("lllllocalpoint222222", contactlocalPoint);
    // 采用相对阈值：如面最小尺寸的 factor 倍
    const threshold = factor * faceDimension;
    // console.log("orianchor, ", faceDimension, originalAnchor);

    // 遍历候选角点，若 contactlocalPoint 与某个角点距离小于阈值，则返回原始 anchor 加上角点描述
    for (let candidate in faceCandidates) {
        const candidatePos = faceCandidates[candidate];
        // console.log("localpoint111111:", localPoint);
        const dist = contactlocalPoint.distanceTo(candidatePos);
        console.log("dist, threshold:", dist, threshold, candidate, candidatePos, contactlocalPoint);
        if (dist < threshold) {
            // 例如返回 "BottomFace" + "FrontLeftCorner" 形式
            console.log("HERE:::", originalAnchor, candidate);
            return `<${originalAnchor}><${candidate}>`;
        }
    }

    return `<${originalAnchor}>`;
}

/**
 * 在导出前，对 connectionData 里每一条连接关系进行重新检测，
 * 将原本的“点对点锚点”统一修正成更语义化的面/边/角连接，例如 "TopFace" / "LeftEdge" / "BackCorner" 等。
 * 
 * 你可根据自己项目对“face/edge/corner”判定阈值做修改。
 */
function refineAllConnections() {
    // 遍历 connectionData 中的每个连接条目
    for (let i = 0; i < connectionData.data.length; i++) {
        const connItem = connectionData.data[i];

        // 典型结构: { "Seat":"<Seat><Board>[<BottomFace><FrontLeftCorner>]", "Base":"<Leg_Front_Left><Block>[<TopFace>]" }
        // 先读取 keyA, keyB
        const keys = Object.keys(connItem);
        if (keys.length < 2) continue; // 略过异常数据

        const keyA = keys[0];
        const keyB = keys[1];
        const strA = connItem[keyA];
        const strB = connItem[keyB];

        // 解析 => { name, type, anchors }
        const cA = Utils.parseConnectionString(strA);
        const cB = Utils.parseConnectionString(strB);
        // 用 name 从场景取出对应 Mesh
        const meshA = objectsByName[cA.name];
        const meshB = objectsByName[cB.name];
        if (!meshA || !meshB) {
            // 找不到对应 Mesh => 跳过
            continue;
        }

        // =========== 1) 判断几何接触关系 ==============
        const contactRes = Utils.checkBoundingBoxContact(meshA, meshB, 2.0 /* eps */);
        console.log("contactRes:", contactRes);
        // Utils.checkBoundingBoxContact 只是判定是否接触 & contactAxis
        // 你可以把它改进成判断面-面 / 边-边 / 角-角 也行。

        if (!contactRes.isTouching) {
            // 若实际没接触，说明只是逻辑上连接(比如远距离依旧 connect?)
            // 根据业务需求自行处理：可能保留原 anchor，不动。
            continue;
        }

        // contactRes 通常返回:
        // {
        //   isTouching: true,
        //   contactAxis: 'y', // x/y/z
        //   contactPointA: Vector3,
        //   contactPointB: Vector3
        // }


        // =========== 2) 根据 contactAxis & contactType & 位置关系 => 确定 A / B 的 anchor 名字 ===========
        if (contactRes.contactType == "face") {
            // let anchorA, anchorB
            const anchors = Utils.getAnchorNameFor(meshA, meshB, contactRes.contactAxis, contactRes.contactType, contactRes.contactPointA, contactRes.contactPointB, contactRes);

            console.log("overall:", anchors);

            // 调用辅助函数，根据接触点进一步 refine anchor 名称
            const refinedAnchorA = AnchorNameIsCorner(anchors.anchorA, meshA, contactRes.contactPointA);
            const refinedAnchorB = AnchorNameIsCorner(anchors.anchorB, meshB, contactRes.contactPointB);

            // const anchorB = Utils.getAnchorNameFor(meshB, meshA);
            // console.log("AAAAAA:", anchorA, anchorB);

            // 你也可以把上面拆得更细：对 corner-edge-face 做不同的 anchorName

            // =========== 4) 更新 connectionData 的锚点字符串 ===========
            // 保留之前的 <ObjA><Board> 头部，只改后面的 [ <...> ]
            let newStrA;
            let newStrB;
            if (anchors.anchorA != "UnknownFace") { newStrA = `<${cA.name}><${cA.type}>[<${cA.anchors}>${refinedAnchorA}]`; }
            if (anchors.anchorB != "UnknownFace") { newStrB = `<${cB.name}><${cB.type}>[<${cB.anchors}>${refinedAnchorB}]`; }

            connItem[keyA] = newStrA;
            connItem[keyB] = newStrB;
        }

    }

    console.log("RefineAllConnections done!");
}

const exportBtn = document.getElementById('exportBtn');
exportBtn.addEventListener('click', () => {

    // 先做碰撞检测 => 给未记录的相邻部件补充连接数据
    detectAndAddConnections();

    // 在真正导出前，做二次检测与修正(点点->面面)
    refineAllConnections();

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
