import json
import random
import os

genres = [
    "Drama","Comedy","Action","Horror","Adventure","Crime","Documentary",
    "Romance","Fantasy","Thriller","Mystery","West","Science Fiction",
    "Family","Animation","History","Music","War","TV Movie"
]

# Distribuzione esemplificativa (somma = 1.0)
weights = [
    0.12,0.11,0.10,0.08,0.07,0.07,0.06,
    0.06,0.06,0.05,0.05,0.04,0.04,
    0.04,0.03,0.03,0.03,0.02,0.01
]

data = []
N = 10000
for t in range(N):
    g = random.choices(genres, weights)[0]
    data.append({"Genre": g})

# crea cartella e salva
os.makedirs("data", exist_ok=True)
with open("data/proreveal-data.json","w",encoding="utf-8") as f:
    json.dump(data, f, indent=1)

print("Creati 10 000 film in data/proreveal-data.json")
