import csv
try:
    with open('data.csv', 'r', encoding='big5') as f:
        reader = csv.reader(f)
        print(next(reader))
except Exception as e:
    print(e)
