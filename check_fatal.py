import json

try:
    with open('data/accidents.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    total = len(data)
    fatal = sum(1 for x in data if x.get('severity') == '死亡')
    injury = sum(1 for x in data if x.get('severity') == '輕傷')
    other = sum(1 for x in data if x.get('severity') == '其他')
    
    output = f"Total: {total}\nFatal (死亡): {fatal}\nInjury (輕傷): {injury}\nOther (其他): {other}"
    print(output)
    with open('fatal_count.txt', 'w', encoding='utf-8') as f_out:
        f_out.write(output)
    
except Exception as e:
    print(f"Error: {e}")
