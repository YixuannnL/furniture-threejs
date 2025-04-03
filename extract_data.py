import re
import pdb
import json
import sys

def split_tag(tags):
    pattern = r'(<[^>]+><[^>]+>\[[^]]+\])'
    tags = re.sub(r"`", "", tags)
    matches = re.findall(pattern, tags)
    # pdb.set_trace()
    return matches

def update_or_add_dict_by_keys(data_list, mainK, v, k2):
    for d in data_list:
        if mainK in d and k2 in d:
            d[mainK] = v
            return
    data_list.append({mainK:v,k2:""})
    
def split_dict_list(input_list):
    result = []
    
    for original_dict in input_list:
        # 获取所有 key 和它们对应的 value 列表
        keys = list(original_dict.keys())
        values_lists = [original_dict[key] if isinstance(original_dict[key], list) else [original_dict[key]] for key in keys]
        
        # 找到最长的 value 列表长度
        max_length = max(len(values) for values in values_lists)
        
        # 遍历每个索引，构造新的字典
        for i in range(max_length):
            new_dict = {}
            for j, key in enumerate(keys):
                # 如果当前索引超出该 key 的 value 列表长度，用空字符串填充
                new_dict[key] = values_lists[j][i] if i < len(values_lists[j]) else ""
            result.append(new_dict)
    
    return result
        

def handle_table_data(table_data):
    
    result = []   
    for k,v in table_data.items():       
        for kk, vv in v.items():
            if vv == '': continue
            vv = split_tag(vv)
            update_or_add_dict_by_keys(result, kk, vv, k)
            result = split_dict_list(result)
    return result
            
            
        

def parse_markdown_tables(text):
    """
    从文本中提取所有 Markdown 表格。
    每个表格假设格式为：第一行为表头，第二行为分隔线，之后的行为数据行。
    返回一个列表，每个元素是一个字典，结构如下：
      {
         "headers": [所有单元格（包括左上角空单元格）],
         "row_labels": [每一行的首个单元格，即行名],
         "data": { 行名: {对应的列名: 单元格内容, ... }, ... }
      }
    """
    lines = text.splitlines()
    tables = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        # 判断是否可能是一个 Markdown 表格的起始行
        if line.startswith('|') and line.count('|') >= 2:
            # 检查下一行是否为分隔行（通常由 - 组成）
            if i+1 < len(lines) and re.match(r'^\|\s*-+', lines[i+1].strip()):
                table_lines = []
                # 收集所有以 "|" 开头的连续行作为一个表格
                while i < len(lines) and lines[i].strip().startswith('|'):
                    table_lines.append(lines[i])
                    i += 1

                # 至少需要表头和分隔行
                if len(table_lines) < 2:
                    continue

                # 解析表头
                header_line = table_lines[0]
                headers = [cell.strip() for cell in header_line.strip().strip('|').split('|')]
                
                # 数据行在第3行开始（第2行为分隔行），解析每一行
                data_rows = table_lines[2:]
                table_data = {}
                row_labels = []
                for row in data_rows:
                    # 跳过空行
                    if not row.strip():
                        continue
                    # 按 "|" 分割并去掉首尾多余的空格
                    cells = [cell.strip() for cell in row.strip().strip('|').split('|')]
                    if not cells:
                        continue
                    # 第一个单元格作为行名
                    row_header = cells[0]
                    row_labels.append(row_header)
                    # 其余单元格与 header 中除第一个之外的项对应
                    cell_dict = {}
                    for j, cell in enumerate(cells[1:], start=1):
                        if j < len(headers):
                            cell_dict[headers[j]] = cell
                    # pdb.set_trace()
                    table_data[row_header] = cell_dict

                table_data = handle_table_data(table_data)
                # 将解析出来的表格信息保存到字典中
                table_info = {
                    "row_headers": headers,
                    "column_header": row_labels,
                    "title": f"table_{len(tables)+1}",
                    "data": table_data
                }
                tables.append(table_info)
                continue  # 已经更新 i，直接进入下一轮循环
        i += 1
    return tables

def parse_json(text):
    # 正则表达式匹配代码块内的 JSON 数据
    pattern = r'```json(.*?)```'
    match = re.search(pattern, text, re.DOTALL)
    if match:
        # 去除前后空白字符
        json_str = match.group(1).strip()
        try:
            # 将字符串解析为 Python 字典对象
            data = json.loads(json_str)
            return data
        except json.JSONDecodeError as e:
            print("解析 JSON 数据失败：", e)
    else:
        print("未在文本中找到 JSON 数据。")

def get_conn_data(txt):
    tables = parse_markdown_tables(txt)
    
    merged_data = {"data":[], "meta_data": []}
    for table in tables:
        merged_data['data'].extend(table.get("data",[]))
        merged_data['meta_data'].append(table)
        
    return merged_data

def get_meta_data(txt):
    
    json_data = parse_json(txt)
    
    return json_data
    

if __name__ == "__main__":
    
    if len(sys.argv) != 5:
        print("用法: python extract_data.py <output_1_path> <meta_input_path> <output_3_path> <conn_input_path>")
        sys.exit(1)
    
    meta_path = sys.argv[2]
    conn_path = sys.argv[4]       
    # meta_path = 'Latest_Gemini_Data/2_Wardrobe/output_2.txt'
    # conn_path = 'Latest_Gemini_Data/2_Wardrobe/output_4.txt'
    
    with open(conn_path, 'r', encoding='utf-8') as file:
        conn_text = file.read()
    with open(meta_path, 'r', encoding='utf-8') as file:
        meta_text = file.read()
        
    conn_data = get_conn_data(conn_text)
    meta_data = get_meta_data(meta_text)
    
    output_conn_file = "conn_data.json"
    output_meta_file = "meta_data.json"
    with open(output_conn_file, "w", encoding="utf-8") as f:
        json.dump(conn_data, f, ensure_ascii=False, indent=4)
    with open(output_meta_file, 'w', encoding='utf-8') as f:
        json.dump(meta_data, f, ensure_ascii=False, indent=4)
    print(f"连接数据已成功保存到 {output_conn_file} ")
    print(f"部件数据已成功保存到 {output_meta_file}")

