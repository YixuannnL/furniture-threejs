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

    // 取出 min/max
    const A_min = boxA.min, A_max = boxA.max;
    const B_min = boxB.min, B_max = boxB.max;

    // 用一个辅助函数测试 1D 区间接触
    const overlapIn1D = (min1, max1, min2, max2) => !(max1 < min2 || max2 < min1);

    // 先判断 x 轴是否接触
    // 条件： (A_max.x ~ B_min.x) or (B_max.x ~ A_min.x)
    //        && 在 y,z 方向上有 overlap
    if (Math.abs(A_max.x - B_min.x) <= eps && overlapIn1D(A_min.y, A_max.y, B_min.y, B_max.y) && overlapIn1D(A_min.z, A_max.z, B_min.z, B_max.z)) {
        return {
            isTouching: true,
            contactAxis: 'x',
            // 取接触面的中点(世界坐标)
            contactPointA: getContactCenterOnAxis(boxA, boxB, 'x', true),
            contactPointB: getContactCenterOnAxis(boxA, boxB, 'x', false)
        };
    }
    if (Math.abs(B_max.x - A_min.x) <= eps && overlapIn1D(A_min.y, A_max.y, B_min.y, B_max.y) && overlapIn1D(A_min.z, A_max.z, B_min.z, B_max.z)) {
        return {
            isTouching: true,
            contactAxis: 'x',
            contactPointA: getContactCenterOnAxis(boxA, boxB, 'x', false),
            contactPointB: getContactCenterOnAxis(boxA, boxB, 'x', true)
        };
    }

    // 再判断 y 轴接触
    if (Math.abs(A_max.y - B_min.y) <= eps && overlapIn1D(A_min.x, A_max.x, B_min.x, B_max.x) && overlapIn1D(A_min.z, A_max.z, B_min.z, B_max.z)) {
        return {
            isTouching: true,
            contactAxis: 'y',
            contactPointA: getContactCenterOnAxis(boxA, boxB, 'y', true),
            contactPointB: getContactCenterOnAxis(boxA, boxB, 'y', false)
        };
    }
    if (Math.abs(B_max.y - A_min.y) <= eps && overlapIn1D(A_min.x, A_max.x, B_min.x, B_max.x) && overlapIn1D(A_min.z, A_max.z, B_min.z, B_max.z)) {
        return {
            isTouching: true,
            contactAxis: 'y',
            contactPointA: getContactCenterOnAxis(boxA, boxB, 'y', false),
            contactPointB: getContactCenterOnAxis(boxA, boxB, 'y', true)
        };
    }

    // z 轴类似
    if (Math.abs(A_max.z - B_min.z) <= eps && overlapIn1D(A_min.x, A_max.x, B_min.x, B_max.x) && overlapIn1D(A_min.y, A_max.y, B_min.y, B_max.y)) {
        return {
            isTouching: true,
            contactAxis: 'z',
            contactPointA: getContactCenterOnAxis(boxA, boxB, 'z', true),
            contactPointB: getContactCenterOnAxis(boxA, boxB, 'z', false)
        };
    }
    if (Math.abs(B_max.z - A_min.z) <= eps && overlapIn1D(A_min.x, A_max.x, B_min.x, B_max.x) && overlapIn1D(A_min.y, A_max.y, B_min.y, B_max.y)) {
        return {
            isTouching: true,
            contactAxis: 'z',
            contactPointA: getContactCenterOnAxis(boxA, boxB, 'z', false),
            contactPointB: getContactCenterOnAxis(boxA, boxB, 'z', true)
        };
    }

    // 否则不接触
    return {
        isTouching: false,
        contactAxis: null
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
