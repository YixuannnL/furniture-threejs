import json
import sys
import pdb

def ensure_backticks(val):
    """
    如果字符串两端没有反引号，则添加反引号
    """
    if not (val.startswith("`") and val.endswith("`")):
        return f"`{val}`"
    return val

def extract_groups_furniture(node, groups, child_mapping, parent_mapping, level, group_info):
    """
    递归遍历 furniture_data（node 为家具的一个节点），
    如果节点中有 children，则：
      - 将这些 children 的 object 名称作为一个组存入 groups；
      - 对每个子节点，在 child_mapping 中记录其所属组索引；
      - 在 parent_mapping 中记录当前节点（父节点）的 object 对应的子组索引；
      - 同时记录 group_info，存入 (父节点名称, children 层级)。
    参数：
      node：当前家具树节点
      groups：存储所有 siblings 组（列表列表）
      child_mapping：子节点名称 -> 所属组索引
      parent_mapping：父节点名称 -> 子组索引（用于 orientationData 校验）
      level：当前节点的层级（根节点层级定义为 0）
      group_info：每个组的 (father, level) 信息
    """
    meta = node.get("meta", {})
    children = meta.get("children")
    if children:
        group_names = []
        for child in children:
            child_meta = child.get("meta", {})
            obj_name = child_meta.get("object")
            if obj_name is None:
                print("Error: 某个子节点缺少 object 名称")
                sys.exit(1)
            if obj_name in child_mapping:
                print(f"Error: 重复的 object 名称 {obj_name}")
                sys.exit(1)
            group_names.append(obj_name)
            child_mapping[obj_name] = len(groups)  # 记录子节点所属组索引
        groups.append(group_names)
        parent_name = meta.get("object")
        if parent_name:
            parent_mapping[parent_name] = len(groups) - 1  # 当前节点（父节点）的 children 对应的组索引
        # 记录 group_info：父节点名称和该组的层级（父节点层级+1，即当前 children 的层级）
        group_info.append((parent_name, level + 1))
        # 递归处理每个子节点
        for child in children:
            extract_groups_furniture(child, groups, child_mapping, parent_mapping, level + 1, group_info)          


def process_orientation_relations(relations):
    """
    对 orientationData 中的 relation 数组进行处理，
    确保每个关系字符串两端都有反引号，并用 <br> 连接
    """
    return "<br>".join(ensure_backticks(r) for r in relations)

def process_orientation_data(orientation_node, parent_mapping, orientation_tables, groups):
    """
    递归处理 orientationData：
    - 根据当前节点的 objectName（即父节点名称），查找其对应的组索引（在 parent_mapping 中）
    - 对该节点的 childrenOrientation 数组中的每条记录：
         * 检查 objectA 和 objectB 是否都在该组中（即 groups[group_index] 中），否则报错
         * 填充 orientation_tables[group_index] 对称的单元格
    - 递归处理 children 中的下一级 orientationData
    """
    obj_name = orientation_node.get("objectName")
    if obj_name not in parent_mapping:
        print(f"Error: orientationData 中的 objectName {obj_name} 在家具数据中没有对应的 children 组")
        sys.exit(1)
    group_index = parent_mapping[obj_name]
    current_group = groups[group_index]
    
    # 处理当前层的 childrenOrientation 数组
    for record in orientation_node.get("childrenOrientation", []):
        objA = record.get("objectA")
        objB = record.get("objectB")
        if objA not in current_group or objB not in current_group:
            print(f"Error: 在 orientationData 中，{objA} 和 {objB} 不属于同一组")
            sys.exit(1)
        relation_str = process_orientation_relations(record.get("relation", []))
        # 填入对称的单元格
        orientation_tables[group_index][objA][objB].append(relation_str)
        # orientation_tables[group_index][objB][objA].append(relation_str)
    
    # 递归处理 children 数组
    for child in orientation_node.get("children", []):
        process_orientation_data(child, parent_mapping, orientation_tables, groups)

def main(path):
    # 加载 JSON 数据
    # with open("furniture_data.json", "r", encoding="utf-8") as f:
    #     furniture_data = json.load(f)
    # with open("connection_data.json", "r", encoding="utf-8") as f:
    #     connection_data = json.load(f)
        
    with open(path, 'r', encoding="utf-8") as f:
        export_data = json.load(f)
    # pdb.set_trace()
    furniture_data = export_data.get("furnitureData")
    connection_data = export_data.get("connectionData")
    orientation_data = export_data.get("orientationData")

    
    # 从家具结构中提取每一层的 siblings 组以及名称映射
    groups = []       # 每个元素是一个列表，表示一组 siblings
    child_mapping = {}      # mapping: object_name -> group_index
    parent_mapping = {} # 父节点名称映射到其子组索引
    group_info = []       # 每个组的 (father, level) 信息
    # root = furniture_data.get("furnitureData")
    # if root is None:
    #     print("Error: 缺少 furnitureData")
    #     sys.exit(1)
    extract_groups_furniture(furniture_data, groups, child_mapping, parent_mapping, 0, group_info)
    
    # 为每个组初始化一个二维表：行和列均为该组内的 object 名称
    # 表格的数据结构用嵌套字典表示：table[row][col] 为一个列表，可能存放多个连接信息
    # 初始化 connection 表格（与之前逻辑一致）
    connection_tables = []
    for group in groups:
        table = {}
        for r in group:
            table[r] = {}
            for c in group:
                table[r][c] = []  # 初始化为空列表
        connection_tables.append(table)

    
    # 处理 connectionData，每个记录必须正好有两个键
    connection_entries = connection_data.get("data", [])
    for entry in connection_entries:
            if len(entry) != 2:
                print("Error: 某条连接记录不包含正好两个键")
                sys.exit(1)
            keys = list(entry.keys())
            key1, key2 = keys[0], keys[1]
            if key1 not in child_mapping or key2 not in child_mapping:
                print(f"Error: 键 {key1} 或 {key2} 不存在于家具结构中")
                sys.exit(1)
            group_index1 = child_mapping[key1]
            group_index2 = child_mapping[key2]
            if group_index1 != group_index2:
                print(f"Error: 键 {key1} 和 {key2} 不在同一组中")
                sys.exit(1)
            group_index = group_index1
            connection_tables[group_index][key1][key2].append(ensure_backticks(entry[key2]))
            connection_tables[group_index][key2][key1].append(ensure_backticks(entry[key1]))
    
    
   # 初始化 orientation 表格，结构同 connection_tables
    orientation_tables = []
    for group in groups:
        table = {}
        for r in group:
            table[r] = {}
            for c in group:
                table[r][c] = []  # 初始化为空列表
        orientation_tables.append(table)
    
    process_orientation_data(orientation_data, parent_mapping, orientation_tables, groups)
    
    # 生成 Markdown 表格字符串，添加说明行
    markdown_conn = ""
    markdown_orient = ""
    
 # 生成 connectionData 的 Markdown 表格
    markdown_conn += "## Connection Tables\n\n"
    for i, group in enumerate(groups):
        father, lvl = group_info[i]
        markdown_conn += f"For {father} Level {lvl}, the connection relationship matrix of its internal components should be as follows:\n\n"
        header = "| " + " | ".join([""] + group) + " |\n"
        separator = "| " + " | ".join(["---"]*(len(group)+1)) + " |\n"
        markdown_conn += header + separator
        table = connection_tables[i]
        for r in group:
            row = f"| {r} "
            for c in group:
                cell = "<br>".join(table[r][c]) if table[r][c] else ""
                row += f"| {cell} "
            row += "|\n"
            markdown_conn += row
        markdown_conn += "\n"
    
    # 生成 orientationData 的 Markdown 表格
    markdown_orient += "## Orientation Tables\n\n"
    for i, group in enumerate(groups):
        father, lvl = group_info[i]
        markdown_orient += f"For {father} Level {lvl}, the positional relationship matrix of its internal components should be as follows:\n\n"
        header = "| " + " | ".join([""] + group) + " |\n"
        separator = "| " + " | ".join(["---"]*(len(group)+1)) + " |\n"
        markdown_orient += header + separator
        table = orientation_tables[i]
        for r in group:
            row = f"| {r} "
            for c in group:
                cell = "<br>".join(table[r][c]) if table[r][c] else ""
                row += f"| {cell} "
            row += "|\n"
            markdown_orient += row
        markdown_orient += "\n"
        
    formatted_json = json.dumps(furniture_data, indent=4, ensure_ascii=False)
    output_text = "```json\n" + formatted_json + "\n```"
    with open("furniture_data.txt", "w", encoding="utf-8") as f:
        f.write(output_text)   
    # 将 connection table 和 orientation table 分别写入不同的 txt 文件
    with open("connection_tables.txt", "w", encoding="utf-8") as f:
        f.write(markdown_conn)
    with open("orientation_tables.txt", "w", encoding="utf-8") as f:
        f.write(markdown_orient)
    
    print("Markdown 表格已存储在三个文件中")

if __name__ == "__main__":
    
    if len(sys.argv) != 2:
        print("Please input the path of json file!")
        sys.exit(1)
        
    input_path = sys.argv[1]
 
    main(input_path)
