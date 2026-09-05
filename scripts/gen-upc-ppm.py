# Minimal dependency-free UPC-A encoder -> PPM (P6). ffmpeg can read PPM directly.
L = ["0001101","0011001","0010011","0111101","0100011",
     "0110001","0101111","0111011","0110111","0001011"]
def upca_bits(code12):
    assert len(code12) == 12 and code12.isdigit()
    # verify check digit
    odd = sum(int(code12[i]) for i in range(0,11,2))
    even = sum(int(code12[i]) for i in range(1,11,2))
    chk = (10 - ((odd*3 + even) % 10)) % 10
    assert chk == int(code12[11]), f"bad check digit: expected {chk}"
    bits = "101"
    for d in code12[:6]:
        bits += L[int(d)]
    bits += "01010"
    for d in code12[6:]:
        bits += "".join("1" if c=="0" else "0" for c in L[int(d)])  # R = complement
    bits += "101"
    return bits

CODE = "049000006346"
bits = upca_bits(CODE)
MODULE = 6          # px per module
QUIET  = 12 * MODULE # generous quiet zone
BAR_H  = 320
W = QUIET*2 + len(bits)*MODULE
H = BAR_H + 160      # white margin top/bottom
rows = []
white = b"\xff\xff\xff"; black = b"\x00\x00\x00"
line_bg = white * W
bar_line = bytearray()
bar_line += white * QUIET
for b in bits:
    bar_line += (black if b == "1" else white) * MODULE
bar_line += white * QUIET
top = 80
for y in range(H):
    rows.append(bytes(bar_line) if top <= y < top + BAR_H else line_bg)
with open("/tmp/upc.ppm","wb") as f:
    f.write(f"P6\n{W} {H}\n255\n".encode())
    for r in rows: f.write(r)
print(f"  wrote /tmp/upc.ppm  {W}x{H}  code={CODE}  modules={len(bits)}")
