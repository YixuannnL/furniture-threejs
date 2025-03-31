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

    //    判断 bar
    //    如果 "最大值" 大于 "中值" 的 3 倍 (阈值3可调),
    //    说明一个维度特别长 => bar(长条)
    if (large >= mid * 3) {
        return 'bar';
    }

    //    判断 board
    //    如果 "中值" 大于 "最小值" 的 5 倍 (阈值5可调),
    //    说明最小值很小(板很薄), 另两个较大 => board(板材)
    if (mid >= small * 5) {
        return 'board';
    }

    // 其余都归类为 block(块)
    return 'block';
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