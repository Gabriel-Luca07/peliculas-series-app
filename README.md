# Películas y Series

Aplicación de escritorio para Windows que te ayuda a llevar el control de las películas y series que tienes pendientes de ver y de las que ya has visto: valoraciones, plataforma, progreso de temporadas/episodios, estadísticas de tu actividad y recomendaciones basadas en [The Movie Database (TMDB)](https://www.themoviedb.org/).

Construida con [Electron](https://www.electronjs.org/) y JavaScript "vanilla" (sin frameworks de frontend), con todos los datos guardados localmente en tu propio ordenador.

---

## Índice

- [Qué puedes hacer con la app](#qué-puedes-hacer-con-la-app)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Instalación (como usuario)](#instalación-como-usuario)
- [Puesta en marcha (como desarrollador)](#puesta-en-marcha-como-desarrollador)
- [Generar el instalador](#generar-el-instalador)
- [Conectar con TMDB](#conectar-con-tmdb)
- [Copias de seguridad: cómo funcionan y cómo restaurarlas](#copias-de-seguridad-cómo-funcionan-y-cómo-restaurarlas)
- [Dónde se guardan tus datos](#dónde-se-guardan-tus-datos)
- [Tecnologías](#tecnologías)

---

## Qué puedes hacer con la app

**Seguimiento de títulos**
- Añadir películas y series como pendientes, en curso ("viendo") o vistas, con plataforma, valoración, notas y fecha.
- Progreso de series por temporada y episodio.
- Marcar una película/serie como vista con un clic desde la propia lista (sin abrir el formulario).
- Volver a marcar como vista ("rewatch") llevando la cuenta de cuántas veces la has visto.
- Añadir varias películas ya vistas de golpe (para volcar tu historial de un tirón) o importar tu historial de visionado desde un CSV de Netflix.
- Selección múltiple: marca varias tarjetas a la vez para cambiarles la plataforma o enviarlas a la papelera juntas.
- Papelera con recuperación durante 30 días antes de borrarse para siempre.

**Integración con TMDB**
- Autocompletar título, año, género, duración, temporadas y póster al buscar.
- Ver en qué plataformas de streaming está disponible cada título.
- Ver el tráiler con un clic.
- Recomendaciones automáticas basadas en lo que ya has valorado.
- Panel de "Próximos estrenos" con la fecha del próximo episodio de las series que sigues.

**Resumen y estadísticas**
- Pendientes, vistas, películas y series vistas por separado, horas vistas (películas y series por separado), valoración media, antigüedad media de tus pendientes y racha de días seguidos viendo algo.
- Gráficas de géneros, plataformas, valoraciones, actividad mensual, vistas por año y década de estreno.
- Aviso de aniversario ("hace un año viste...") y resumen anual estilo "wrapped".
- "¿Qué veo hoy?": elige al azar un título de tus pendientes.

**Personalización**
- Tema claro/oscuro, color de acento (6 disponibles), color de las gráficas, densidad de las listas y animaciones activables/desactivables.
- Plataformas personalizadas, orden y tamaño de página configurables, panel de inicio a elegir.
- Copia de seguridad automática configurable (ver más abajo).

---

## Estructura del proyecto

```
PeliculasApp/
├── main.js                  Proceso principal de Electron: ventana, acceso a disco,
│                             llamadas a la API de TMDB, copias de seguridad automáticas.
├── preload.js                Puente seguro (contextBridge) entre main.js y la interfaz.
├── package.json              Dependencias y configuración del instalador (electron-builder).
├── IniciarApp.bat             Atajo para lanzar la app en modo desarrollo sin instalarla.
│
├── renderer/                 Todo lo que se ve y ejecuta dentro de la ventana.
│   ├── index.html             Estructura de todas las pantallas (Resumen, Pendientes,
│   │                           Vistas, Papelera, Ajustes) y los modales.
│   ├── renderer.js             Toda la lógica de la interfaz: render de listas y gráficas,
│   │                           filtros, formularios, ajustes, animaciones.
│   ├── style.css               Estilos, temas, animaciones y diseño responsive.
│   └── fonts/                  Tipografía Inter empaquetada localmente (funciona sin internet).
│
├── build/
│   ├── icon.ico                Icono de la app para Windows (varios tamaños).
│   └── icon.png                 Icono en PNG (256×256).
│
└── release/                   Carpeta de salida del instalador (se genera con `npm run dist`,
                                 no viene incluida en el repositorio).
```

---

## Instalación (como usuario)

Si solo quieres usar la aplicación, sin tocar código:

1. Ve a la sección **Releases** de este repositorio y descarga el instalador más reciente
   (`Peliculas y Series Setup X.X.X.exe`).
2. Ejecútalo y sigue el asistente (puedes elegir la carpeta de instalación).
3. Al terminar, tendrás un acceso directo en el menú Inicio y, si lo marcaste, en el escritorio.

También se genera una versión **portable** (`Peliculas y Series X.X.X.exe`) que no requiere
instalación: descárgala y ejecútala directamente.

> La aplicación funciona sin conexión para llevar tu lista, pero necesita una clave gratuita de
> TMDB para el autocompletado, pósters, tráilers, recomendaciones y próximos estrenos. Ver
> [Conectar con TMDB](#conectar-con-tmdb).

---

## Puesta en marcha (como desarrollador)

Requisitos: [Node.js](https://nodejs.org/) (versión 18 o superior recomendada).

```bash
git clone https://github.com/<tu-usuario>/<tu-repositorio>.git
cd PeliculasApp
npm install
npm start
```

`npm start` abre la aplicación en modo desarrollo, cargando los archivos directamente desde disco
(cualquier cambio en `renderer/` se refleja al recargar la ventana con Ctrl+R).

---

## Generar el instalador

```bash
npm run dist
```

Esto usa [electron-builder](https://www.electron.build/) para generar, dentro de `release/`:

- Un instalador NSIS (`Peliculas y Series Setup X.X.X.exe`).
- Una versión portable (`Peliculas y Series X.X.X.exe`).

Ambos quedan firmados con el icono de `build/icon.ico`. Como es una app de uso personal sin
certificado de firma de código, Windows SmartScreen puede mostrar un aviso la primera vez que se
ejecuta el instalador en un ordenador nuevo; es esperable y no indica ningún problema.

---

## Conectar con TMDB

1. Crea una cuenta gratuita en [themoviedb.org](https://www.themoviedb.org/) y genera una clave de
   API (Configuración → API).
2. En la app, ve a **Ajustes → Conexión con TMDB**, pega la clave, elige idioma y región, y guarda.
3. A partir de ese momento, buscar un título autocompleta sus datos y desbloquea plataformas,
   tráiler, recomendaciones y próximos estrenos.

Sin clave de TMDB la app sigue funcionando con normalidad para llevar tu lista de forma manual;
simplemente no tendrás esas funciones adicionales.

---

## Copias de seguridad: cómo funcionan y cómo restaurarlas

### Automáticas

Activadas por defecto (Ajustes → Copia de seguridad y datos). Cada vez que abres la app, si no
existe ya una copia de hoy, se guarda una en una carpeta `backups` dentro de tus datos, y se borran
las que tengan más de N días (configurable, 14 por defecto). También puedes forzar una copia en
cualquier momento con el botón "Hacer copia ahora".

### Manuales

Los botones "Exportar" e "Importar" hacen lo mismo pero eligiendo tú el archivo y la ubicación
(útil para guardar una copia puntual en la nube o llevártela a otro ordenador).

### Cómo restaurar una copia

1. Ajustes → **"Abrir carpeta de copias"** para ver los archivos `backup-AAAA-MM-DD.json`
   disponibles (esto abre la carpeta correcta automáticamente, sea cual sea el ordenador).
2. Ajustes → **"Importar"** y selecciona el archivo que quieras restaurar.
3. Confirma el aviso: importar **reemplaza** tu lista actual por la del archivo, no la mezcla.

Esto solo restaura tu lista de películas/series; no afecta a la Papelera ni a tus ajustes.

### Llevar tus datos a otro ordenador

Cada instalación es independiente: en un ordenador nuevo, la app empieza con la lista vacía y su
propia carpeta de copias, sin sincronizarse con las de otros ordenadores. Para trasladar tus datos,
usa Exportar en el ordenador de origen e Importar en el de destino (o copia manualmente la carpeta
de datos completa, ver más abajo).

---

## Dónde se guardan tus datos

Todo se guarda localmente, nunca en un servidor externo:

```
%APPDATA%\peliculas-app\
├── movies.json     Tu lista de películas y series.
├── trash.json      Papelera (elementos eliminados, purga automática a los 30 días).
├── settings.json   Clave de TMDB, idioma, región y preferencias de copia de seguridad.
└── backups\        Copias de seguridad automáticas y manuales.
```

En Windows normalmente es `C:\Users\<tu usuario>\AppData\Roaming\peliculas-app\`. Puedes abrir esta
carpeta directamente desde Ajustes → "Abrir carpeta de datos".

---

## Tecnologías

- [Electron](https://www.electronjs.org/) — empaqueta la app como aplicación de escritorio.
- HTML, CSS y JavaScript sin frameworks — toda la interfaz es "vanilla".
- [TMDB API](https://developer.themoviedb.org/docs) — metadatos, pósters, tráilers, recomendaciones y disponibilidad en plataformas.
- [electron-builder](https://www.electron.build/) — generación del instalador para Windows.
- Tipografía [Inter](https://rsms.me/inter/), empaquetada localmente.
