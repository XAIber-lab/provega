import pandas as pd
df = pd.read_csv('parcourVis2000.csv', encoding='cp1252', sep=',') 
df.to_csv('parcourVis2000.utf8.csv', index=False, encoding='utf-8')
