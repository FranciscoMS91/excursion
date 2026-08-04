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
5. **Optimizar viaje.** La app calcula la ruta y reparte las visitas por jornadas.
6. **Ajustar.** Arrastra las visitas para reordenarlas, quítalas con ✕, o marca alguna
   como obligatoria (☆) para que siempre entre en el plan. Cada cambio recalcula horarios
   y kilómetros al instante.
7. **Exportar.** CSV del itinerario, fichero `.ics` para el calendario, enlace de Google
   Maps por jornada, o imprimir/guardar en PDF.

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
4. **Construcción del viaje.** Inserción voraz por ratio *puntuación / tiempo extra*: en
   cada paso entra la visita que más aporta por cada minuto que añade al recorrido,
   siempre que siga cabiendo en la agenda. Después se afina el orden con **2-opt** y
   **Or-opt** para recortar kilómetros.
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
| Teselas de OpenStreetMap | Fondo del mapa | Siempre que el mapa esté visible |

La cartera **no sale del navegador**: no hay backend ni cuenta de usuario. Sólo se envían
a esos servicios las direcciones a geocodificar y las coordenadas de las paradas.

Ambos son servicios públicos gratuitos con límites de uso pensados para volúmenes
pequeños. Para uso intensivo conviene levantar una instancia propia de OSRM/Nominatim y
cambiar la URL en `js/routing.js` y `js/geocode.js`.

---

## Limitaciones conocidas

- El servidor público de OSRM limita la matriz a unos 100 puntos: por eso existe el ajuste
  *Máx. paradas candidatas* (95 como tope). Por encima se pasa a tiempos estimados.
- No hay ventanas horarias por cliente (todavía): sólo horario general de jornada.
- El reparto por días asume que se pernocta en la última parada del día; no busca hotel ni
  optimiza el punto de pernocta.
- Si no hay conexión, la app sigue funcionando con tiempos estimados, pero el fondo del
  mapa aparecerá en blanco y no se podrán geocodificar direcciones nuevas.

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
│   ├── demo-data.js        91 empresas ficticias de ejemplo
│   └── app.js              Arranque y conexión entre piezas
├── vendor/                 Leaflet y SheetJS incluidos (funciona sin CDN)
└── ejemplo-clientes.csv    Plantilla de importación
```
