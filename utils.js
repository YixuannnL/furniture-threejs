import * as THREE from 'three';

export function getCenterPoint(mesh) {
    var middle = new THREE.Vector3();
    var geometry = mesh.geometry;

    geometry.computeBoundingBox();

    middle.x = (geometry.boundingBox.max.x + geometry.boundingBox.min.x) / 2;
    middle.y = (geometry.boundingBox.max.y + geometry.boundingBox.min.y) / 2;
    middle.z = (geometry.boundingBox.max.z + geometry.boundingBox.min.z) / 2;

    mesh.localToWorld(middle);
    return middle;
}

export function findBarAxisAndEnds(mesh) {
    const geom = mesh.geometry;
    const { width, height, depth } = geom.parameters;
    let axisName = 'x';
    let axisSize = width;
    if (height > axisSize) {
        axisName = 'y';
        axisSize = height;
    }
    if (depth > axisSize) {
        axisName = 'z';
        axisSize = depth;
    }

    // 依据 axisName，定义两端
    let end1Name, end2Name;
    let end1Coord, end2Coord;
    if (axisName === 'x') {
        end1Name = 'LeftEnd';
        end2Name = 'RightEnd';
        end1Coord = new THREE.Vector3(-width / 2, 0, 0);
        end2Coord = new THREE.Vector3(+width / 2, 0, 0);
    }
    else if (axisName === 'y') {
        end1Name = 'BottomEnd';
        end2Name = 'TopEnd';
        end1Coord = new THREE.Vector3(0, -height / 2, 0);
        end2Coord = new THREE.Vector3(0, +height / 2, 0);
    }
    else {
        end1Name = 'BackEnd';
        end2Name = 'FrontEnd';
        end1Coord = new THREE.Vector3(0, 0, -depth / 2);
        end2Coord = new THREE.Vector3(0, 0, +depth / 2);
    }

    return { axisName, axisSize, end1Name, end2Name, end1Coord, end2Coord };
}

export function getFaceFractionAnchor(localPos, width, height, depth) {
    // 1) 计算与 6 面边界的距离
    const distFront = Math.abs(localPos.z - depth / 2);
    const distBack = Math.abs(localPos.z + depth / 2);
    const distLeft = Math.abs(localPos.x + width / 2);
    const distRight = Math.abs(localPos.x - width / 2);
    const distBottom = Math.abs(localPos.y + height / 2);
    const distTop = Math.abs(localPos.y - height / 2);

    // 2) 找到最近面的 faceType
    let faceType = 'FrontFace';
    let minDist = distFront;
    if (distBack < minDist) { faceType = 'BackFace'; minDist = distBack; }
    if (distLeft < minDist) { faceType = 'LeftFace'; minDist = distLeft; }
    if (distRight < minDist) { faceType = 'RightFace'; minDist = distRight; }
    if (distBottom < minDist) { faceType = 'BottomFace'; minDist = distBottom; }
    if (distTop < minDist) { faceType = 'TopFace'; minDist = distTop; }

    // 3) 在该面内计算分数 param1, param2
    //   (0~1) => clamp 避免浮点误差越界
    const clamp01 = v => Math.min(1, Math.max(0, v));

    let param1 = 0;
    let param2 = 0;

    switch (faceType) {
        case 'FrontFace':
            param1 = (localPos.y + height / 2) / height;  // 高度方向(0=底,1=顶)
            param2 = (localPos.x + width / 2) / width;   // 宽度方向(0=左,1=右)
            break;
        case 'BackFace':
            param1 = (localPos.y + height / 2) / height;
            param2 = (localPos.x + width / 2) / width;
            break;
        case 'LeftFace':
            param1 = (localPos.y + height / 2) / height;
            param2 = (localPos.z + depth / 2) / depth;   // 深度方向(0=前,1=后)
            break;
        case 'RightFace':
            param1 = (localPos.y + height / 2) / height;
            param2 = (localPos.z + depth / 2) / depth;
            break;
        case 'BottomFace':
            param1 = (localPos.z + depth / 2) / depth;
            param2 = (localPos.x + width / 2) / width;
            break;
        case 'TopFace':
            param1 = (localPos.z + depth / 2) / depth;
            param2 = (localPos.x + width / 2) / width;
            break;
    }

    param1 = clamp01(param1);
    param2 = clamp01(param2);

    // 将分数(0~1) 转成 "1/2,1/3..." 形式
    function decimalToFraction(value, maxDen = 10) {
        let best = { num: 1, den: 1, err: Math.abs(value - 1) };
        for (let d = 1; d <= maxDen; d++) {
            let n = Math.round(value * d);
            let approx = n / d;
            let err = Math.abs(value - approx);
            if (err < best.err) {
                best = { num: n, den: d, err };
            }
        }
        return best.num + '/' + best.den;
    }
    const frac1 = decimalToFraction(param1);
    const frac2 = decimalToFraction(param2);

    // 4) 拼装字符串
    //    - front/back => <FrontFace_1/3Height_1/2Width>
    //    - left/right => <LeftFace_1/3Height_1/2Depth>
    //    - bottom/top => <BottomFace_1/3Depth_1/2Width>
    let anchorStr = '';
    switch (faceType) {
        case 'FrontFace':
        case 'BackFace':
            anchorStr = `<${faceType}_${frac1}Height_${frac2}Width>`;
            break;
        case 'LeftFace':
        case 'RightFace':
            anchorStr = `<${faceType}_${frac1}Height_${frac2}Depth>`;
            break;
        case 'BottomFace':
        case 'TopFace':
            anchorStr = `<${faceType}_${frac1}Depth_${frac2}Width>`;
            break;
    }
    return anchorStr;
}

export function getObjectType(dimensions) {
    const { width, height, depth } = dimensions;

    // 排序，得到 small, mid, large
    const sorted = [width, height, depth].sort((a, b) => a - b);
    const small = sorted[0];
    const mid = sorted[1];
    const large = sorted[2];

    //    判断 board
    //    如果 "中值" 大于 "最小值" 的 5 倍 (阈值5可调),
    //    说明最小值很小(板很薄), 另两个较大 => board(板材)
    if (mid >= small * 5) {
        return 'board';
    }

    //    判断 bar
    //    如果 "最大值" 大于 "中值" 的 3 倍 (阈值3可调),
    //    说明一个维度特别长 => bar(长条)
    if (large >= mid * 3) {
        return 'bar';
    }

    // 其余都归类为 block(块)
    return 'block';
}

// 帮助函数：根据 (faceIndex // 2) 找拉伸轴 axis + 正负号 sign
export function getFaceAxisAndSign(mesh, rawFaceIndex, eor = false) {
    // 先把faceIndex 归一化到0~5
    // console.log("HERE");
    let faceIndex = Math.floor(rawFaceIndex / 2);
    if (eor) {
        faceIndex = faceIndex ^ 1;
    }

    // 0和1 => +/- X
    // 2和3 => +/- Y
    // 4和5 => +/- Z
    // 你也可以沿用自己已经写的 getFaceAxisByIndex() 来取 axis, sign
    let axis = null;
    let sign = null;
    // console.log("faceindex", faceIndex);
    if (faceIndex === 0) { axis = 'width'; sign = +1; }
    else if (faceIndex === 1) { axis = 'width'; sign = -1; }
    else if (faceIndex === 2) { axis = 'height'; sign = +1; }
    else if (faceIndex === 3) { axis = 'height'; sign = -1; }
    else if (faceIndex === 4) { axis = 'depth'; sign = +1; }
    else if (faceIndex === 5) { axis = 'depth'; sign = -1; }

    return { axis, sign };
}

// =============================
// 获取 BoxGeometry 面对应的轴
//   faceIndex -> faceId = floor(faceIndex/2)
//   根据 faceId 判断 +X/-X, +Y/-Y, +Z/-Z
// =============================
export function getFaceAxisByIndex(faceIndex) {
    const faceId = Math.floor(faceIndex / 2);
    // BoxGeometry 通常 0->+Z,1->-Z,2->+Y,3->-Y,4->+X,5->-X (部分版本可能顺序不同)
    switch (faceId) {
        case 0: return { axis: 'width', sign: +1 };   // +Z
        case 1: return { axis: 'width', sign: -1 };   // -Z
        case 2: return { axis: 'height', sign: +1 };  // +Y
        case 3: return { axis: 'height', sign: -1 };  // -Y
        case 4: return { axis: 'depth', sign: +1 };  // +X
        case 5: return { axis: 'depth', sign: -1 };  // -X
        default: return { axis: null, sign: 0 };
    }
}

export function getAllMeshesInScene(root) {
    const meshes = [];
    root.traverse(obj => {
        if (obj.isMesh) {
            meshes.push(obj);
        }
    });
    return meshes;
}

export function checkBoundingBoxContact(meshA, meshB, eps = 1e-3) {
    meshA.updateMatrixWorld(true);
    meshB.updateMatrixWorld(true);

    // 若 geometry 没有 boundingBox，就先 compute
    if (!meshA.geometry.boundingBox) {
        meshA.geometry.computeBoundingBox();
    }
    if (!meshB.geometry.boundingBox) {
        meshB.geometry.computeBoundingBox();
    }

    // 复制一份 boundingBox
    const boxA = meshA.geometry.boundingBox.clone();
    const boxB = meshB.geometry.boundingBox.clone();
    // 转到世界坐标
    boxA.applyMatrix4(meshA.matrixWorld);
    boxB.applyMatrix4(meshB.matrixWorld);

    // 对三个轴分别计算重叠长度
    const overlapX = Math.min(boxA.max.x, boxB.max.x) - Math.max(boxA.min.x, boxB.min.x);
    const overlapY = Math.min(boxA.max.y, boxB.max.y) - Math.max(boxA.min.y, boxB.min.y);
    const overlapZ = Math.min(boxA.max.z, boxB.max.z) - Math.max(boxA.min.z, boxB.min.z);

    // 如果有任一轴重叠为负，则说明盒子之间存在间隙，返回不接触
    if (overlapX < 0 || overlapY < 0 || overlapZ < 0) {
        return {
            isTouching: false,
            contactAxis: null,
            penetrationDepth: 0,
            contactPointA: null,
            contactPointB: null
        };
    }

    // 对重叠值取最大(防止小负数误差)
    const ox = Math.max(overlapX, 0);
    const oy = Math.max(overlapY, 0);
    const oz = Math.max(overlapZ, 0);

    // 统计近似为零的轴数
    let zeroCount = 0;
    if (Math.abs(ox) <= eps) zeroCount++;
    if (Math.abs(oy) <= eps) zeroCount++;
    if (Math.abs(oz) <= eps) zeroCount++;

    let contactType = 'face'; // 默认
    if (zeroCount === 2) {
        contactType = 'edge';
    } else if (zeroCount === 3) {
        contactType = 'corner';
    }

    // 盒子有接触：可以认为它们的交集体积不为 0（或至少边界刚好相接）
    // 确定主要接触轴为重叠最小的轴
    let minOverlap = ox;
    let contactAxis = 'x';
    if (oy < minOverlap) { minOverlap = oy; contactAxis = 'y'; }
    if (oz < minOverlap) { minOverlap = oz; contactAxis = 'z'; }

    // 如果是 edge 或 corner 接触，则让接触轴取那些重叠近零的轴（这里按照 x→y→z 优先顺序）
    if (zeroCount >= 2) {
        if (Math.abs(ox) <= eps) {
            contactAxis = 'x';
            minOverlap = 0;
        } else if (Math.abs(oy) <= eps) {
            contactAxis = 'y';
            minOverlap = 0;
        } else if (Math.abs(oz) <= eps) {
            contactAxis = 'z';
            minOverlap = 0;
        }
    }

    // 计算接触点：在 contactAxis 上，我们选取与另一盒子更近的那一面，其他轴取盒子中心（面中心）
    let contactPointA = new THREE.Vector3();
    let contactPointB = new THREE.Vector3();

    if (contactAxis === 'x') {
        const delta1 = Math.abs(boxA.max.x - boxB.min.x);
        const delta2 = Math.abs(boxB.max.x - boxA.min.x);
        if (delta1 <= delta2) {
            // A 的右侧面与 B 的左侧面接触
            contactPointA.set(boxA.max.x, (boxA.min.y + boxA.max.y) / 2, (boxA.min.z + boxA.max.z) / 2);
            contactPointB.set(boxB.min.x, (boxB.min.y + boxB.max.y) / 2, (boxB.min.z + boxB.max.z) / 2);
        } else {
            // A 的左侧面与 B 的右侧面接触
            contactPointA.set(boxA.min.x, (boxA.min.y + boxA.max.y) / 2, (boxA.min.z + boxA.max.z) / 2);
            contactPointB.set(boxB.max.x, (boxB.min.y + boxB.max.y) / 2, (boxB.min.z + boxB.max.z) / 2);
        }
    }
    else if (contactAxis === 'y') {
        const delta1 = Math.abs(boxA.max.y - boxB.min.y);
        const delta2 = Math.abs(boxB.max.y - boxA.min.y);
        if (delta1 <= delta2) {
            // A 上侧与 B 下侧接触
            contactPointA.set((boxA.min.x + boxA.max.x) / 2, boxA.max.y, (boxA.min.z + boxA.max.z) / 2);
            contactPointB.set((boxB.min.x + boxB.max.x) / 2, boxB.min.y, (boxB.min.z + boxB.max.z) / 2);
        } else {
            // A 下侧与 B 上侧接触
            contactPointA.set((boxA.min.x + boxA.max.x) / 2, boxA.min.y, (boxA.min.z + boxA.max.z) / 2);
            contactPointB.set((boxB.min.x + boxB.max.x) / 2, boxB.max.y, (boxB.min.z + boxB.max.z) / 2);
        }
    }
    else if (contactAxis === 'z') {
        const delta1 = Math.abs(boxA.max.z - boxB.min.z);
        const delta2 = Math.abs(boxB.max.z - boxA.min.z);
        if (delta1 <= delta2) {
            // A 的前侧面与 B 的后侧面接触
            contactPointA.set((boxA.min.x + boxA.max.x) / 2, (boxA.min.y + boxA.max.y) / 2, boxA.max.z);
            contactPointB.set((boxB.min.x + boxB.max.x) / 2, (boxB.min.y + boxB.max.y) / 2, boxB.min.z);
        } else {
            // A 的后侧面与 B 的前侧面接触
            contactPointA.set((boxA.min.x + boxA.max.x) / 2, (boxA.min.y + boxA.max.y) / 2, boxA.min.z);
            contactPointB.set((boxB.min.x + boxB.max.x) / 2, (boxB.min.y + boxB.max.y) / 2, boxB.max.z);
        }
    }

    return {
        isTouching: true,
        contactAxis: contactAxis,
        penetrationDepth: minOverlap, // 这里可以代表最小的重叠量
        contactType: contactType,
        contactPointA: contactPointA,
        contactPointB: contactPointB
    };
}

export function guessAnchorFromContact(mesh, contactAxis, contactWorldPos) {
    // 转为本地坐标
    const localPos = mesh.worldToLocal(contactWorldPos.clone());

    // 取出尺寸
    if (!mesh.geometry || !mesh.geometry.parameters) {
        // 如果不是 box 或者无参数，则返回一个默认 anchor
        return 'Center';
    }
    const { width, height, depth } = mesh.geometry.parameters;

    // 把 localPos 转成 [0..1] 范围，以便构造 fraction
    //   xFrac = (local.x + width/2) / width
    //   yFrac = (local.y + height/2) / height
    //   zFrac = (local.z + depth/2) / depth
    const xFrac = (localPos.x + width / 2) / width;
    const yFrac = (localPos.y + height / 2) / height;
    const zFrac = (localPos.z + depth / 2) / depth;

    // 依据 contactAxis 决定优先把哪个面作为 anchor
    //   如果 contactAxis='x'，那说明 x=±width/2 处接触 => likely <RightFace> or <LeftFace>
    //   但要看 localPos.x 大约是 +width/2 (1.0) 还是 -width/2 (0.0)
    //   如果非常接近 0.0 => <LeftFace>；如果接近 1.0 => <RightFace>；如果在 0.2 之类 => <LeftFace_??Height_??Depth>
    let anchor = convertLocalPosToAnchorString(xFrac, yFrac, zFrac);
    return anchor;
}

// 若 obj3D 是 Group，则取它所有子节点（Mesh）包围盒的并集 (union)；
// 若是单个 Mesh，则直接拿它的 geometry.boundingBox 并转换到世界坐标；
// 返回 THREE.Box3
export function computeWorldBoundingBoxForObject(obj3D) {
    if (!obj3D) return null;

    // 更新世界矩阵
    obj3D.updateMatrixWorld(true);

    // 如果是 Mesh
    if (obj3D.isMesh) {
        const geo = obj3D.geometry;
        if (!geo || !geo.boundingBox) {
            geo.computeBoundingBox();
        }
        const boxLocal = geo.boundingBox.clone();
        return boxLocal.applyMatrix4(obj3D.matrixWorld);
    }
    // 如果是 Group => 遍历子节点
    let unionBox = new THREE.Box3();
    let hasAtLeastOne = false;

    obj3D.traverse(child => {
        if (child.isMesh && child.geometry) {
            child.updateMatrixWorld(true);
            if (!child.geometry.boundingBox) {
                child.geometry.computeBoundingBox();
            }
            const boxLocal = child.geometry.boundingBox.clone();
            boxLocal.applyMatrix4(child.matrixWorld);
            if (!hasAtLeastOne) {
                unionBox.copy(boxLocal);
                hasAtLeastOne = true;
            } else {
                unionBox.union(boxLocal);
            }
        }
    });

    return hasAtLeastOne ? unionBox : null;
}

export function findPathInFurnitureData(rootMeta, targetName) {
    // 若自己就是
    if (rootMeta.object === targetName) {
        return [rootMeta];
    }
    // 若有子节点，则逐个递归
    if (Array.isArray(rootMeta.children)) {
        for (const child of rootMeta.children) {
            const subPath = findPathInFurnitureData(child.meta, targetName);
            if (subPath) {
                // 找到了
                return [rootMeta, ...subPath];
            }
        }
    }
    // 没找到
    return null;
}

export function getOrientationLabels(boxA, boxB) {
    // 1) 判断是否包围（Encased/Encasing）
    if (isBoxInside(boxA, boxB)) {
        // A 被 B 包围 => A对B = <Encased>
        return ["<Encased>"];
    }
    if (isBoxInside(boxB, boxA)) {
        // A 包围 B => A对B = <Encasing>
        return ["<Encasing>"];
    }

    // 2) 否则根据中心点相对位置，多轴一起判断
    const centerA = boxA.getCenter(new THREE.Vector3());
    const centerB = boxB.getCenter(new THREE.Vector3());
    const dx = centerB.x - centerA.x;
    const dy = centerB.y - centerA.y;
    const dz = centerB.z - centerA.z;

    // 找到三者绝对值的最大值
    const absX = Math.abs(dx), absY = Math.abs(dy), absZ = Math.abs(dz);
    const maxAbs = Math.max(absX, absY, absZ);

    // 如果三者都非常小(意味着几乎重叠？)
    if (maxAbs < 1e-6) {
        return ["<Unknown>"];
    }

    // 给定一个阈值比率 (越小 => 越容易出现多标签)
    const ratio = 0.2;

    let tags = [];

    // 若某维度绝对值 >= ratio * maxAbs => 说明这个维度也算“显著”
    if (absX >= ratio * maxAbs) {
        tags.push(dx > 0 ? "<Right>" : "<Left>");
    }
    if (absY >= ratio * maxAbs) {
        tags.push(dy > 0 ? "<Top>" : "<Bottom>");
    }
    if (absZ >= ratio * maxAbs) {
        tags.push(dz > 0 ? "<Front>" : "<Back>");
    }

    // 如果全部轴都没达到 ratio*maxAbs（可能因为 ratio 过大），就至少取最大轴
    if (tags.length === 0) {
        // 直接选最大轴
        if (absX >= absY && absX >= absZ) {
            tags.push(dx > 0 ? "<Right>" : "<Left>");
        } else if (absY >= absZ) {
            tags.push(dy > 0 ? "<Top>" : "<Bottom>");
        } else {
            tags.push(dz > 0 ? "<Front>" : "<Back>");
        }
    }

    return tags;
}

/** 判断 box1 是否完全包含在 box2 内部 */
function isBoxInside(box1, box2, eps = 1e-3) {
    // box1的min >= box2的min && box1的max <= box2的max
    // 允许少量 eps 误差
    return (
        box1.min.x >= box2.min.x - eps &&
        box1.min.y >= box2.min.y - eps &&
        box1.min.z >= box2.min.z - eps &&
        box1.max.x <= box2.max.x + eps &&
        box1.max.y <= box2.max.y + eps &&
        box1.max.z <= box2.max.z + eps
    );
}

// 当我们知道 A 的 max.x ~ B 的 min.x 之类时，可以在另外两轴上取区间交集的中心，然后在第一个轴上取对应的 min/max 点，得到接触面的中心点
// 可能需要更复杂的逻辑来处理多面相交、斜面等情况(?)
function getContactCenterOnAxis(boxA, boxB, axis, isA_side) {
    // 计算 yz(或xy/ xz) 的交集中心 + x(或y,z) 的边界
    const center = new THREE.Vector3();

    // a) 取另外两个轴的 overlap 区间中点
    //   如果 axis='x'，那另外两个轴是'y','z'
    let axis1, axis2;
    if (axis === 'x') { axis1 = 'y'; axis2 = 'z'; }
    if (axis === 'y') { axis1 = 'x'; axis2 = 'z'; }
    if (axis === 'z') { axis1 = 'x'; axis2 = 'y'; }

    const overlapMin1 = Math.max(boxA.min[axis1], boxB.min[axis1]);
    const overlapMax1 = Math.min(boxA.max[axis1], boxB.max[axis1]);
    const overlapMin2 = Math.max(boxA.min[axis2], boxB.min[axis2]);
    const overlapMax2 = Math.min(boxA.max[axis2], boxB.max[axis2]);

    const mid1 = (overlapMin1 + overlapMax1) / 2;
    const mid2 = (overlapMin2 + overlapMax2) / 2;

    center[axis1] = mid1;
    center[axis2] = mid2;

    // b) 取当前axis方向上的相应值
    //    若 isA_side=true，说明这是 A 的表面 => 用 boxA 的 max/ min
    if (isA_side) {
        if (Math.abs(boxA.max[axis] - boxB.min[axis]) < 1e-3) {
            center[axis] = boxA.max[axis];
        } else if (Math.abs(boxA.min[axis] - boxB.max[axis]) < 1e-3) {
            center[axis] = boxA.min[axis];
        } else {
            // 其它情况(如果有多重匹配)可再区分
            center[axis] = (boxA.min[axis] + boxA.max[axis]) / 2;
        }
    } else {
        if (Math.abs(boxB.max[axis] - boxA.min[axis]) < 1e-3) {
            center[axis] = boxB.max[axis];
        } else if (Math.abs(boxB.min[axis] - boxA.max[axis]) < 1e-3) {
            center[axis] = boxB.min[axis];
        } else {
            center[axis] = (boxB.min[axis] + boxB.max[axis]) / 2;
        }
    }

    return center;
}


/**
 * 将 (xFrac,yFrac,zFrac) => 类似 "RightFace_1/4Height_1/2Depth" 这种简易写法
 *   - 当 xFrac≈1 => "RightFace"
 *   - 当 xFrac≈0 => "LeftFace"
 *   - 当 yFrac≈1 => "TopFace"、yFrac≈0 => "BottomFace" ...
 *   - 若不是很接近，则自动拼成 e.g. "RightFace_3/8Height_1/2Depth"
 */
function convertLocalPosToAnchorString(xFrac, yFrac, zFrac) {
    // 先定义阈值
    const nearZero = 0.05;
    const nearOne = 0.95;

    // 尝试判断 xFrac => left/right face
    if (xFrac < nearZero) {
        // 左边
        return buildFaceWithFractions('LeftFace', yFrac, zFrac);
    }
    if (xFrac > nearOne) {
        // 右边
        return buildFaceWithFractions('RightFace', yFrac, zFrac);
    }

    // 尝试判断 yFrac => top/bottom face
    if (yFrac < nearZero) {
        return buildFaceWithFractions('BottomFace', xFrac, zFrac);
    }
    if (yFrac > nearOne) {
        return buildFaceWithFractions('TopFace', xFrac, zFrac);
    }

    // zFrac => front/back face
    if (zFrac < nearZero) {
        return buildFaceWithFractions('FrontFace', xFrac, yFrac);
    }
    if (zFrac > nearOne) {
        return buildFaceWithFractions('BackFace', xFrac, yFrac);
    }

    // 如果都不在边缘，那就简单返回 "Center" 或你要的形式
    return 'Center';
}

/**
 * 把 faceName + (frac1, frac2) => e.g. "RightFace_1/4Height_1/2Depth"
 *   这里仅作示例，假设第一个 fraction 是 'Height'，第二个 fraction 是 'Depth'（或别的...）
 *   也可根据 faceName 不同来决定 fraction 对应 (width/height) or (height/depth) ...
 */
function buildFaceWithFractions(faceName, f1, f2) {
    // 将 0.25 => "1/4"，0.5 => "1/2" 之类 (仅简单硬编码)
    let fraction1 = floatToFraction(f1);
    let fraction2 = floatToFraction(f2);
    // 这里示例: "RightFace_1/4Height_1/2Depth"
    return `${faceName}_${fraction1}Height_${fraction2}Depth`;
}


/**
 * 简易函数：将常见小数转换成 "1/2", "1/3", "3/4" 之类
 * 若无法匹配, 就返回 e.g. "0.33"
 */
function floatToFraction(f) {
    // 常见值:
    const lookup = {
        '0': '0',
        '0.25': '1/4',
        '0.3333': '1/3',
        '0.5': '1/2',
        '0.6667': '2/3',
        '0.75': '3/4',
        '1': '1'
    };
    // 在 lookup 里找最接近
    let best = null;
    let minDiff = 999;
    for (let k in lookup) {
        const fv = parseFloat(k);
        let diff = Math.abs(fv - f);
        if (diff < minDiff) {
            minDiff = diff;
            best = lookup[k];
        }
    }
    // 若太大误差，就直接保留两位小数
    if (minDiff > 0.05) {
        return f.toFixed(2);
    } else {
        return best;
    }
}


// --------------------------------------------------------------------------------------------
// 解析 “<名称><类型>[<锚点A><锚点B>...]” 格式的字符串，并返回 { name, type, anchors:[] }
//    比如: "<Seat><Board>[<BottomFace><FrontLeftCorner>]" -> 
//          { name:"Seat", type:"Board", anchors:["BottomFace","FrontLeftCorner"] }
// --------------------------------------------------------------------------------------------
export function parseConnectionString(str) {
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

/**
 * 返回在 connectionData 中出现过的所有名称 (Set<string>)
 */
export function getAllConnectedNames(connectionData) {
    const connectedNames = new Set();
    if (!connectionData || !connectionData.data) return connectedNames;

    for (const item of connectionData.data) {
        // 检查每个 item 是否恰好含有两个键值对
        const keys = Object.keys(item);
        if (keys.length !== 2) continue;

        // 检查两个键对应的值是否均不为空（包括空字符串）
        const values = Object.values(item);
        if (values.some(val => val === "")) continue; // 任一值为空则跳过

        for (const k of keys) {
            const str = item[k] || "";
            // 用你已有的 parseConnectionString(str)
            // 它返回 { name, type, anchors:[] }
            const parsed = parseConnectionString(str);
            if (parsed && parsed.name) {
                connectedNames.add(parsed.name);
            }
        }
    }
    return connectedNames;
}


/**
 * 计算所有已连接对象在世界坐标系下合并后的包围盒 (Box3)。
 * 若完全没有已连接对象，则返回 null
 */
export function computeConnectedObjectsBoundingBox(rootObject, connectionData) {
    const connectedNames = getAllConnectedNames(connectionData);
    let box = new THREE.Box3();
    let hasAny = false;

    rootObject.traverse(obj => {
        if (obj.isMesh && connectedNames.has(obj.name)) {
            // expandByObject 可以递归包含其子，但是对于 Mesh 通常只需 expandByObject(obj)
            // 注意：要先 updateMatrixWorld
            obj.updateMatrixWorld(true);
            box.expandByObject(obj);
            hasAny = true;
        }
    });

    return hasAny ? box : null;
}

/**
 * 计算盒子在本地坐标下的 8 个角点
 * 返回一个数组 [v1, v2, ..., v8], 每个都是 THREE.Vector3
 */
export function computeBoxCorners(width, height, depth) {
    const w2 = width / 2;
    const h2 = height / 2;
    const d2 = depth / 2;
    // 所有 (±w/2, ±h/2, ±d/2) 的组合
    const signCombis = [
        [+1, +1, +1],
        [+1, +1, -1],
        [+1, -1, +1],
        [+1, -1, -1],
        [-1, +1, +1],
        [-1, +1, -1],
        [-1, -1, +1],
        [-1, -1, -1],
    ];
    const corners = [];
    signCombis.forEach(([sx, sy, sz]) => {
        corners.push(new THREE.Vector3(sx * w2, sy * h2, sz * d2));
    });
    return corners;
}

/**
 * 计算盒子的 12 条边线段，每条边用 { start:Vector3, end:Vector3 } 表示
 * 入参 corners: 8 个角点坐标 (本地坐标)
 */
export function computeBoxEdges(corners) {
    // 索引说明: 参考 corners 的顺序
    // 不一定必须严格按“点的顺序”来，但需要正确拼出 12 条边
    // 可以根据坐标关系来找共边点，这里示例直接手动写出 indices
    const edgeIndices = [
        [0, 1], [0, 2], [0, 4], // 以 corner 0 为起点的 3 条边
        [1, 3], [1, 5],
        [2, 3], [2, 6],
        [3, 7],
        [4, 5], [4, 6],
        [5, 7],
        [6, 7]
    ];
    const edges = edgeIndices.map(([i1, i2]) => {
        return {
            start: corners[i1].clone(),
            end: corners[i2].clone()
        };
    });
    return edges;
}

// 将原始conn data中的无用连接数据过滤掉
export function filterConnData(conn_data) {
    conn_data.data = conn_data.data.filter(item => {
        return Object.values(item).every(value => value != "");
    });
    return conn_data;
}


/**
 * 在 furnitureData.meta 中递归找到名为 targetName 的 meta
 * @return {Object|null} 找不到则返回 null
 */
export function findMetaByName(rootMeta, targetName) {
    if (rootMeta.object === targetName) {
        return rootMeta;
    }
    if (rootMeta.children && Array.isArray(rootMeta.children)) {
        for (const child of rootMeta.children) {
            const r = findMetaByName(child.meta, targetName);
            if (r) return r;
        }
    }
    return null;
}


/**
 * 收集某个 meta 节点（包括其所有子节点）的名称列表
 * @param {Object} meta - 家具结构节点
 * @returns {string[]} names - 该节点及子节点的 meta.object 名称
 */
export function collectAllMeshNames(meta) {
    let results = [];
    if (meta.object) {
        results.push(meta.object);
    }

    if (meta.children && Array.isArray(meta.children)) {
        meta.children.forEach(child => {
            // 注意：这里 child 可能是 { meta: {...} }，也可能直接就是 meta  
            let childMeta = child.meta ? child.meta : child;
            results = results.concat(collectAllMeshNames(childMeta));
        });
    }

    return results;
}



/**
 * 示例：计算在剩余 2 轴上的重叠率
 * @param {THREE.Box3} boxA 
 * @param {THREE.Box3} boxB 
 * @param {string} contactAxis - 'x'|'y'|'z'
 * @returns {object} { axis1Ratio, axis2Ratio } 取值 [0..1]
 */
export function getOverlapRatio(boxA, boxB, contactAxis) {
    // 比如 contactAxis='y'，则 axis1='x', axis2='z'
    let axis1, axis2;
    if (contactAxis === 'x') {
        axis1 = 'y'; axis2 = 'z';
    } else if (contactAxis === 'y') {
        axis1 = 'x'; axis2 = 'z';
    } else {
        axis1 = 'x'; axis2 = 'y';
    }

    // 分别算 axis1 / axis2 上的交集长度 / min(各自长度)
    const overlap1 = get1DOverlap(boxA.min[axis1], boxA.max[axis1], boxB.min[axis1], boxB.max[axis1]);
    const overlap2 = get1DOverlap(boxA.min[axis2], boxA.max[axis2], boxB.min[axis2], boxB.max[axis2]);

    // boxA 在 axis1 的长度
    const lenA1 = boxA.max[axis1] - boxA.min[axis1];
    const lenB1 = boxB.max[axis1] - boxB.min[axis1];
    const lenA2 = boxA.max[axis2] - boxA.min[axis2];
    const lenB2 = boxB.max[axis2] - boxB.min[axis2];

    const axis1Ratio = overlap1 / Math.min(lenA1, lenB1);
    const axis2Ratio = overlap2 / Math.min(lenA2, lenB2);

    return { axis1Ratio, axis2Ratio };
}

/** 计算一维区间 [min1, max1] 和 [min2, max2] 的重叠长度 */
export function get1DOverlap(min1, max1, min2, max2) {
    const overlapMin = Math.max(min1, min2);
    const overlapMax = Math.min(max1, max2);
    return Math.max(0, overlapMax - overlapMin);
}

/**
 * 根据两个 mesh 的世界包围盒、各轴上的交叠情况以及尺寸比较，
 * 为单个 mesh 返回推荐的接触面名称（例如 "TopFace" 或 "LeftEdge"）。
 *
 * 原则：
 * 1. 对每个轴（x, y, z），分别考察 A 的正（例如 A.max.x 与 B.min.x）和负方向（例如 A.min.x 与 B.max.x）的候选；
 * 2. 计算候选方向在其它两个轴上的重叠率（归一化到 A 自身尺寸），重叠率高说明交叠充分；
 * 3. 候选中先优先选择重叠率高者（如果有距离误差，两者间距离较小者优先）；
 * 4. 如果 meshA 为 board 类型且最佳候选的轴恰好是该 board 的薄轴（即尺寸最小者），则认为该面属于窄侧，用 "Edge" 替换 "Face"。
 *
 * @param {THREE.Mesh} meshA - 当前需要确定接触面的 mesh
 * @param {THREE.Mesh} meshB - 与 meshA 接触的另一个 mesh
 * @param {number} eps - 距离容差（默认 1e-3）
 * @returns {string} - 如 "TopFace", "LeftEdge" 等
 */
export function getContactFaceName(meshA, meshB, eps = 1e-3) {
    // 确保最新 worldMatrix
    meshA.updateMatrixWorld(true);
    meshB.updateMatrixWorld(true);
    // 计算并确保 geometry 的 boundingBox 存在
    if (!meshA.geometry.boundingBox) meshA.geometry.computeBoundingBox();
    if (!meshB.geometry.boundingBox) meshB.geometry.computeBoundingBox();

    // 复制 boundingBox 并转换到世界坐标
    const boxA = meshA.geometry.boundingBox.clone();
    const boxB = meshB.geometry.boundingBox.clone();
    boxA.applyMatrix4(meshA.matrixWorld);
    boxB.applyMatrix4(meshB.matrixWorld);

    // 候选信息：每个候选包括：axis（'x','y','z'）、side ('positive' 或 'negative')、两者间的距离、以及在其它两个轴上的最小重叠率。
    let candidates = [];

    // 辅助：计算在除指定轴以外的两个轴上的重叠率
    function computeOverlap(axis, boxA, boxB) {
        let otherAxes = ['x', 'y', 'z'].filter(a => a !== axis);
        let ratios = otherAxes.map(a => {
            let overlap = Math.min(boxA.max[a], boxB.max[a]) - Math.max(boxA.min[a], boxB.min[a]);
            let sizeA = boxA.max[a] - boxA.min[a];
            return (sizeA > 0) ? (overlap / sizeA) : 0;
        });
        return Math.min(...ratios);
    }

    // 对每个轴添加候选面
    ['x', 'y', 'z'].forEach(axis => {
        // 正方向候选：A 的最大边界与 B 的最小边界
        let dPos = Math.abs(boxA.max[axis] - boxB.min[axis]);
        let overlapRatioPos = computeOverlap(axis, boxA, boxB);
        // 如果距离小于 eps（即近似贴合），或者两个盒子在其它轴上有正重叠（overlap > 0），则作为候选
        if (dPos <= eps || overlapRatioPos > 0) {
            candidates.push({ axis: axis, side: 'positive', distance: dPos, overlapRatio: overlapRatioPos });
        }
        // 负方向候选：A 的最小边界与 B 的最大边界
        let dNeg = Math.abs(boxB.max[axis] - boxA.min[axis]);
        let overlapRatioNeg = computeOverlap(axis, boxA, boxB);
        if (dNeg <= eps || overlapRatioNeg > 0) {
            candidates.push({ axis: axis, side: 'negative', distance: dNeg, overlapRatio: overlapRatioNeg });
        }
    });

    if (candidates.length === 0) return "UnknownFace";

    // 选择最佳候选：优先重叠率高，其次距离小
    candidates.sort((a, b) => {
        if (b.overlapRatio !== a.overlapRatio) return b.overlapRatio - a.overlapRatio;
        return a.distance - b.distance;
    });
    const best = candidates[0];

    // 根据最佳候选确定基本名称
    let baseName = "UnknownFace";
    if (best.axis === 'x') {
        baseName = (best.side === 'positive') ? "RightFace" : "LeftFace";
    } else if (best.axis === 'y') {
        baseName = (best.side === 'positive') ? "TopFace" : "BottomFace";
    } else if (best.axis === 'z') {
        baseName = (best.side === 'positive') ? "FrontFace" : "BackFace";
    }

    // 针对 board 类型，判断是否应将“Face”改为“Edge”。
    // 规则：先获取 boxA 的尺寸，从 width, height, depth 中找出最小的维度作为薄轴，
    // 如果最佳候选的 axis 正好和薄轴一致，则认为该面是狭窄的，使用“Edge”命名
    const dims = meshA.geometry.parameters;
    if (dims) {
        const objType = getObjectType({ width: dims.width, height: dims.height, depth: dims.depth });
        if (objType === "board") {
            const dimsArr = [
                { axis: 'width', value: dims.width },
                { axis: 'height', value: dims.height },
                { axis: 'depth', value: dims.depth }
            ];
            dimsArr.sort((a, b) => a.value - b.value);
            if (baseName == "RightFace" || baseName == "LeftFace") {
                if (dimsArr[0].axis == "height" || dimsArr[0].axis == "depth") baseName = baseName.replace("Face", "Edge");
            }
            else if (baseName == "TopFace" || baseName == "BottomFace") {
                if (dimsArr[0].axis == "width" || dimsArr[0].axis == "depth") baseName = baseName.replace("Face", "Edge");
            }
            else if (baseName == "FrontFace" || baseName == "BackFace") {
                if (dimsArr[0].axis == "width" || dimsArr[0].axis == "height") baseName = baseName.replace("Face", "Edge");
            }
        }
    }
    console.log("basename: ", baseName);
    return baseName;
}


/**
 * 修改后的 getAnchorNameFor 函数：
 * 对于传入的两个 mesh，分别调用 getContactFaceName 得到各自的锚点名称，
 * 并返回一个对象 { anchorA, anchorB }。
 *
 * 注意：即便 meshA 与 meshB 的接触并非严格对应（例如 meshA 接触左侧，meshB 可能接触顶部），
 * 这种函数独立计算各自的最佳接触面名称，可以反映实际重叠情况。
 *
 * @param {THREE.Mesh} meshA
 * @param {THREE.Mesh} meshB
 * @returns {object} { anchorA, anchorB }
 */
export function getAnchorNameFor(meshA, meshB) {
    const anchorA = getContactFaceName(meshA, meshB);
    const anchorB = getContactFaceName(meshB, meshA);
    console.log("anchor:", anchorA, anchorB);
    return { anchorA, anchorB };
}