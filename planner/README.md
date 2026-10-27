# Planificador de viajes comerciales — Península Ibérica

Aplicación web para preparar viajes de negocio de forma gráfica: sitúa tu cartera de
clientes y prospectos sobre el mapa, elige origen y destino, y calcula el recorrido que
**maximiza el número de visitas** que caben en los días disponibles.

No necesita instalación, ni build, ni servidor: es HTML + CSS + JavaScript, y todos los
datos se guardan en el navegador (`localStorage`).

---

## Cómo abrirla

La forma recomendada es servir la carpeta por HTTP (el navegador bloquea algunas
peticiones cuando se abre un fichero con `file://`):

```bash
cd excursion
python3 -m http.server 8000
# y abrir http://localhost:8000/planner/
```

También funciona publicándola en **GitHub Pages** (Settings → Pages → rama y carpeta
raíz); la app quedaría en `https://<usuario>.github.io/excursion/planner/`.

### Versión en un solo fichero

`planner-standalone.html` es la misma app con los estilos, los scripts, Leaflet y SheetJS
incrustados: un único fichero de ~1,2 MB que se abre con doble clic desde cualquier
carpeta, sin necesidad del resto del repositorio. Se regenera con:

```bash
python3 planner/build-standalone.py
```

Hay que volver a generarlo cada vez que se toque `index.html`, el CSS o el JavaScript.
Dos diferencias respecto a la versión servida: la cartera se guarda por fichero (si lo
mueves de carpeta, el navegador lo trata como otro origen y no verás los datos
importados), y el botón de geolocalización no funciona porque los navegadores lo
restringen a HTTPS y localhost.

---

## Flujo de trabajo

1. **Datos → Importar cartera.** Carga un CSV, TSV o Excel con tus clientes. También
   puedes empezar con `Cargar ejemplo` (91 empresas ficticias por toda la península) o
   dar de alta registros a mano en la pestaña *Cartera*.
2. **Datos → Geocodificar pendientes.** Convierte las direcciones en coordenadas para
   poder situarlas en el mapa. Va a 1 dirección por segundo (política de uso de
   Nominatim) y guarda los resultados en caché, así que sólo se hace una vez.
3. **Viaje → Recorrido.** Escribe tu punto de partida (o pulsa 📍 para usar el GPS) y el
   destino. Elige entre:
   - **Radio en destino**: visitar lo que haya alrededor del destino.
   - **Corredor del trayecto**: aprovechar el camino de ida y vuelta, incluyendo todo lo
     que quede a X km de la línea origen→destino.
4. **Viaje → Calendario y filtros.** Días de viaje, horario de jornada, duración media de
   visita, pausa de comida, y a quién quieres ver (tipo, prioridad, sector, etiqueta,
   tiempo sin visitar).
5. **Citas ya pactadas.** Si tienes una reunión cerrada, abre ese cliente en *Cartera* y
   rellena «Cita pactada» con la fecha y la hora. Esa visita queda clavada a esa hora y
   todo lo demás se organiza a su alrededor (ver más abajo).
6. **Optimizar viaje.** La app calcula la ruta y reparte las visitas por jornadas.
7. **Ajustar.** Arrastra las visitas para reordenarlas, quítalas con ✕, o marca alguna
   como obligatoria (☆) para que siempre entre en el plan. Cada cambio recalcula horarios
   y kilómetros al instante.
8. **Exportar.** CSV del itinerario, fichero `.ics` para el calendario, enlace de Google
   Maps por jornada, o imprimir/guardar en PDF.

---

## Citas pactadas

Una cita pactada es una reunión con hora cerrada. Marcarla cambia el viaje entero:

- **Se respeta la hora exacta.** La visita se clava a esa hora y no se puede arrastrar; el
  resto del día se construye antes y después de ella.
- **Entra siempre en el viaje**, aunque los filtros o la zona de búsqueda la dejasen fuera:
  es un compromiso, no una propuesta.
- **Su entorno entra también.** Todo lo que esté a menos de X km de la cita (35 por
  defecto, ajustable) pasa a ser candidato aunque quede fuera del radio o del corredor. Si
  tienes reunión en Zaragoza, verás el resto de empresas de Zaragoza aunque el viaje fuera
  Madrid–Barcelona.
- **Se duerme cerca si hace falta.** Si saliendo por la mañana no da tiempo a llegar, el
  desplazamiento se hace la tarde anterior y la jornada siguiente arranca junto a la cita.
  Aparece en la agenda como *«Desplazamiento para dormir cerca de la cita»*.
- **Se rellenan los huecos.** Debajo de cada cita, la app lista las empresas cercanas que
  caben en los ratos libres de ese día, con la hora concreta a la que encajarían y lo que
  cuestan en tiempo y kilómetros. Un botón las añade al itinerario.
- **Avisa si no llegas.** Si la hora es inalcanzable, sale un aviso con cuántos minutos
  tarde llegarías y qué puedes tocar para arreglarlo, en vez de inventarse un horario.

Ejemplo: con una reunión a las 10:00 y 60 minutos de duración, la jornada queda como
*salida 08:30 → visita cercana 08:32–09:32 → hueco de 26 min → **cita 10:00–11:00** →
siguiente visita propuesta a las 11:08*.

Si dejas la fecha en blanco y pones sólo la hora, se respeta esa hora el día en que la
visita acabe cayendo.

---

## Formato de los datos

El importador empareja las columnas automáticamente. Reconoce cabeceras en español y las
de una **exportación de Apollo.io** (`Company`, `Company Address`, `Company City`,
`Company Phone`, `Industry`, `Annual Revenue`, `Last Contacted`…). Antes de importar
verás la correspondencia detectada y podrás corregir cualquier columna a mano.

| Campo | Alias reconocidos (ejemplos) | Notas |
|---|---|---|
| Nombre | `Nombre`, `Empresa`, `Company`, `Razón social` | Obligatorio |
| Dirección | `Direccion`, `Calle`, `Company Address` | |
| CP / Ciudad / Provincia / País | `CP`, `Ciudad`, `Provincia`, `Company City`… | Se usan para geocodificar |
| Contacto / Cargo | `Contacto`, `First Name` + `Last Name`, `Title` | |
| Teléfono / Email / Web | `Telefono`, `Company Phone`, `Email`, `Website` | |
| Sector | `Sector`, `Industry` | Sirve de filtro |
| Tipo | `Tipo`, `Stage`, `Status` | `cliente` o `prospecto` |
| Prioridad | `Prioridad`, `Priority`, `A/B/C` | alta / media / baja |
| Valor | `Valor`, `Annual Revenue`, `Potencial` | Euros, admite `1.234,56` |
| Última visita | `UltimaVisita`, `Last Contacted` | `AAAA-MM-DD` o `DD/MM/AAAA` |
| Duración visita | `DuracionMin` | Minutos; si falta, se usa el valor por defecto |
| Cita pactada | `FechaCita`, `HoraCita`, `Fecha reunión`, `Appointment Time` | Hora cerrada: `10:00`, `10.30`, `9h15`, `8:30 p.m.` |
| Latitud / Longitud | `Latitud`, `Longitud` | Si vienen, se ahorra la geocodificación |

Tienes una plantilla lista en [`ejemplo-clientes.csv`](ejemplo-clientes.csv).

---

## Cómo decide la ruta

1. **Selección de candidatos.** Se filtra la cartera (tipo, prioridad, sector, etiqueta,
   días sin visitar) y se queda con lo que cae dentro del radio del destino o del
   corredor del trayecto.
2. **Puntuación.** Cada candidato recibe una puntuación combinando prioridad, valor
   potencial y tiempo transcurrido desde la última visita. Los pesos son ajustables, y el
   deslizador *Enfoque* permite inclinar el viaje hacia fidelizar clientes o hacia captar
   prospectos.
3. **Matriz de tiempos.** Se pide a **OSRM** el tiempo y la distancia reales por carretera
   entre todos los puntos. Si no hay conexión o hay demasiadas paradas, se estima con
   distancia geodésica × factor de desvío a la velocidad media configurada (la app avisa
   de cuál de las dos ha usado).
4. **Construcción del viaje.** Las citas pactadas forman el esqueleto, en orden
   cronológico. Sobre él, inserción voraz por ratio *puntuación / tiempo extra*: en cada
   paso entra la visita que más aporta por cada minuto que añade al recorrido, probando
   varias posiciones y descartando las que romperían una cita. Después se afina el orden
   con **2-opt** y **Or-opt**, que nunca cruzan una cita pactada.
5. **Reparto por días.** Se simula la agenda hora a hora respetando el horario de jornada
   y la pausa de comida; cuando un día se llena, se pernocta en la última parada y el día
   siguiente arranca desde allí. Lo que no cabe aparece listado aparte como
   *«No caben en este viaje»*.

Es una heurística, no un óptimo demostrable: el problema (selección + rutas + ventanas
horarias) es NP-duro. En la práctica da planes muy cercanos al mejor posible y se
recalcula en menos de un segundo.

---

## Servicios externos y privacidad

| Servicio | Para qué | Cuándo se usa |
|---|---|---|
| [Nominatim](https://nominatim.openstreetmap.org) | Convertir direcciones en coordenadas | Al geocodificar; resultados en caché |
| [OSRM](https://project-osrm.org) (servidor público de demostración) | Tiempos reales y trazado de las rutas | Al optimizar, si está activado |
| Teselas de mapa (opcional) | Calles y carreteras de fondo | Sólo si eliges un proveedor con clave |

La cartera **no sale del navegador**: no hay backend ni cuenta de usuario. Sólo se envían
a esos servicios las direcciones a geocodificar y las coordenadas de las paradas.

**Sobre el mapa base:** por defecto la app **no pide el mapa a ningún servidor**. Lleva
dentro los contornos de la península y unas sesenta ciudades de referencia
(`js/basemap-data.js`, generado a partir de Natural Earth, de dominio público), que es
suficiente para planificar a escala de viaje y funciona siempre, incluso sin conexión.

Los servicios públicos de teselas ya no sirven para este caso: los servidores de
OpenStreetMap están mantenidos por voluntarios y bloquean las aplicaciones que no se
identifican (devuelven «Access blocked», y cualquier fichero abierto con `file://` entra
ahí), y CARTO exige clave desde hace tiempo. Si quieres ver calles y carreteras, en
*Datos → Mapa base* eliges «Teselas con mi clave» y pegas la URL de un proveedor donde
te hayas registrado; en MapTiler o Geoapify la clave gratuita se saca en dos minutos:

```
https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=TU_CLAVE
```

Ambos son servicios públicos gratuitos con límites de uso pensados para volúmenes
pequeños. Para uso intensivo conviene levantar una instancia propia de OSRM/Nominatim y
cambiar la URL en `js/routing.js` y `js/geocode.js`.

---

## Limitaciones conocidas

- El servidor público de OSRM limita la matriz a unos 100 puntos: por eso existe el ajuste
  *Máx. paradas candidatas* (95 como tope). Por encima se pasa a tiempos estimados.
- Se admiten horas cerradas, pero no ventanas del tipo «de 9 a 11»: una cita es un
  instante fijo, no un rango.
- El reparto por días asume que se pernocta en la última parada del día (o junto a la cita
  del día siguiente, si hace falta desplazarse la tarde anterior); no busca hotel.
- Sin conexión la app sigue siendo utilizable: mapa base propio y tiempos estimados. Lo
  que no funciona es geocodificar direcciones nuevas ni obtener tiempos reales de
  carretera.
- El mapa base propio tiene contornos y ciudades, no calles: para ver el callejero hace
  falta un proveedor de teselas con clave.

---

## Estructura

```
planner/
├── index.html              Interfaz
├── css/planner.css         Estilos (incluye hoja de impresión)
├── js/
│   ├── util.js             Utilidades: geometría, fechas, formato
│   ├── store.js            Modelo de cliente y persistencia en localStorage
│   ├── csv.js              Lectura de CSV y mapeo automático de columnas
│   ├── geocode.js          Nominatim con caché y control de ritmo
│   ├── routing.js          Matriz de tiempos y geometría (OSRM + estimación)
│   ├── optimize.js         Selección, puntuación, 2-opt/Or-opt y reparto por días
│   ├── map.js              Capas de Leaflet
│   ├── itinerary.js        Panel de itinerario y exportaciones (CSV, ICS, Maps)
│   ├── clients.js          Cartera: listado, ficha e importación
│   ├── basemap-data.js     Contornos y ciudades del mapa propio
│   ├── demo-data.js        91 empresas ficticias de ejemplo
│   └── app.js              Arranque y conexión entre piezas
├── vendor/                 Leaflet y SheetJS incluidos (funciona sin CDN)
├── build-standalone.py     Genera la versión de un solo fichero
├── planner-standalone.html Versión autocontenida (generada)
└── ejemplo-clientes.csv    Plantilla de importación
```
