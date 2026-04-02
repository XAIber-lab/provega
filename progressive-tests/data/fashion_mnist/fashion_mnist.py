import gzip, struct, json
from pathlib import Path

def read_images(path: Path):
    """Ritorna (list_of_bytes, num_images, rows, cols)"""
    with gzip.open(path, 'rb') as f:
        magic, num = struct.unpack(">II", f.read(8))
        if magic != 0x00000803:
            raise ValueError(f"Magic number mismatch for images: {hex(magic)}")
        rows, cols = struct.unpack(">II", f.read(8))
        data = f.read(num * rows * cols)
        return data, num, rows, cols

def read_labels(path: Path):
    """Ritorna (list_of_labels, num_labels)"""
    with gzip.open(path, 'rb') as f:
        magic, num = struct.unpack(">II", f.read(8))
        if magic != 0x00000801:
            raise ValueError(f"Magic number mismatch for labels: {hex(magic)}")
        data = f.read(num)
        return data, num

if __name__ == "__main__":
    img_path = Path("train-images-idx3-ubyte.gz")
    lbl_path = Path("train-labels-idx1-ubyte.gz")

    # 1) Carica raw
    imgs_raw, n_imgs, rows, cols = read_images(img_path)
    labels_raw, n_lbls            = read_labels(lbl_path)
    assert n_imgs == n_lbls, "Numero di immagini e labels diverso!"

    # 2) Quanti esempi esportare?
    N = min(1500, n_imgs)

    # 3) Costruisci la lista di records
    out = []
    for i in range(N):
        offset = i * rows * cols
        pixels = list(imgs_raw[offset:offset + rows*cols])
        out.append({
            "id":     i,
            "label":  int(labels_raw[i]),
            "pixels": pixels
        })

    # 4) Scrivi su JSON
    with open("fashion_mnist_1500.json", "w") as f:
        json.dump(out, f)
    print(f"Wrote {N} records to fashion_mnist_1000.json")
