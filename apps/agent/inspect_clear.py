from app.dahua import DahuaClient
import re

c = DahuaClient('192.168.190.31', 'admin', 'Masterkey4846', 80)
js_url = f"{c.base}/static/js/9.5949d493.chunk.js"
r = c.session.get(js_url, verify=False)

for term in ["clear", "clean", "remove", "delete", "RecordUpdater", "AccessControlCardRec"]:
    pos = 0
    while True:
        pos = r.text.find(term, pos)
        if pos == -1:
            break
        snippet = r.text[max(0, pos-100):min(len(r.text), pos+200)]
        if any(k in snippet for k in ["Record", "AccessControl", "Finder", "Updater"]):
            print(f"[{term}] -> {snippet}\n")
        pos += len(term)
        if pos > 50000:
            break
