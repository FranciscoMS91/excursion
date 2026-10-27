# -*- coding: utf-8 -*-
"""Genera una version de la app en un unico fichero HTML autocontenido."""
import base64, io, os, re, sys

SRC = '/home/user/excursion/planner'
OUT = os.path.join(SRC, 'planner-standalone.html')

def read(rel):
    with io.open(os.path.join(SRC, rel), encoding='utf-8') as f:
        return f.read()

html = read('index.html')

# 1. Imagenes de Leaflet como data URI dentro de su CSS
leaflet_css = read('vendor/leaflet.css')
for name in os.listdir(os.path.join(SRC, 'vendor', 'images')):
    with open(os.path.join(SRC, 'vendor', 'images', name), 'rb') as f:
        b64 = base64.b64encode(f.read()).decode('ascii')
    leaflet_css = leaflet_css.replace('images/' + name, 'data:image/png;base64,' + b64)

# 2. Hojas de estilo en linea
def style(css):
    return '<style>\n' + css + '\n</style>'

html = html.replace('<link rel="stylesheet" href="vendor/leaflet.css" />', style(leaflet_css))
html = html.replace('<link rel="stylesheet" href="css/planner.css" />', style(read('css/planner.css')))

# 3. Scripts en linea, respetando el orden del documento
def inline_script(match):
    src = match.group(1)
    code = read(src).replace('</script', '<\\/script')
    return '<script>\n' + code + '\n</script>'

html = re.sub(r'<script src="([^"]+)"></script>', inline_script, html)

# 4. El enlace a la plantilla CSV no existe fuera de la carpeta: se quita
html = html.replace(
    '<a class="link-sample" href="ejemplo-clientes.csv" download>Descargar plantilla CSV</a>',
    '<span class="link-sample" style="color:var(--muted)">Plantilla CSV: ver planner/ejemplo-clientes.csv en el repositorio</span>')

# 5. Sello de version con la fecha de generacion
import datetime
sello = 'v1.5 \u00b7 citas desde Viaje \u00b7 fichero \u00fanico ' + datetime.date.today().isoformat()
html = html.replace('v1.5 \u00b7 citas desde la pestaña Viaje', sello)

leftovers = re.findall(r'(?:src|href)="(?!data:|https?:|#|mailto:|tel:)([^"]+)"', html)
if leftovers:
    print('AVISO, referencias externas sin incrustar:', leftovers)

with io.open(OUT, 'w', encoding='utf-8') as f:
    f.write(html)
print('escrito %s (%.1f MB)' % (OUT, os.path.getsize(OUT) / 1048576.0))
