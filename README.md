# Películas y Series

Aplicación de escritorio para Windows que te ayuda a llevar el control de las películas y series que tienes pendientes de ver y de las que ya has visto: valoraciones, plataforma, progreso de temporadas/episodios, estadísticas de tu actividad y recomendaciones basadas en [The Movie Database (TMDB)](https://www.themoviedb.org/).

Construida con [Electron](https://www.electronjs.org/) y JavaScript "vanilla" (sin frameworks de frontend), con todos los datos guardados localmente en tu propio ordenador.

---

## Índice

- [Qué puedes hacer con la app](#qué-puedes-hacer-con-la-app)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Instalación (como usuario)](#instalación-como-usuario)
- [Cómo actualizar la app sin perder tus datos](#cómo-actualizar-la-app-sin-perder-tus-datos)
- [Puesta en marcha (como desarrollador)](#puesta-en-marcha-como-desarrollador)
- [Generar el instalador](#generar-el-instalador)
- [Conectar con TMDB](#conectar-con-tmdb)
- [Perfiles: varios usuarios en el mismo ordenador](#perfiles-varios-usuarios-en-el-mismo-ordenador)
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
- Recomendaciones automáticas en la pantalla de Resumen: mezclan títulos parecidos a lo que has
  valorado con novedades en tendencia (para no quedarte siempre con "más de lo mismo"), con una
  pequeña cuota de series entre las películas. El botón de recargar muestra selecciones distintas
  cada vez, sin repetirse hasta agotar las opciones disponibles.
- Panel de "Próximos estrenos" con la fecha del próximo episodio de las series que sigues.

**Recomendar a otras personas**
- Apartado **Recomendar**: crea listas de recomendaciones pensadas para compartir con otra gente,
  con un menú de opciones para elegir qué incluir (películas, series o ambas; géneros concretos;
  la plataforma en la que esa persona ve contenido —Netflix, Prime Video...—; cuántos títulos).
  Se nutren sobre todo de tus mejor valoradas y tus pendientes con más posibilidades (según tus
  géneros favoritos), añadiendo solo una pequeña minoría de descubrimiento para dar variedad.
- Además de la lista automática, puedes **editarla a mano**: quitar cualquier título con un clic o
  buscar y añadir cualquier película o serie de TMDB, esté o no en tu biblioteca. También existe un
  **modo Manual** para saltarte el algoritmo por completo y montar la lista tú solo, título a
  título.
- Cada lista se genera como una **imagen** (pósters en cuadrícula, título y tu nombre de perfil)
  lista para compartir, y queda guardada con fecha en un historial dentro del propio apartado,
  desde donde puedes volver a abrirla o borrarla.

**Resumen y estadísticas**
- Pendientes, vistas, películas y series vistas por separado, horas vistas (películas y series por separado), valoración media, antigüedad media de tus pendientes y racha de días seguidos viendo algo.
- Gráficas de géneros, plataformas, valoraciones, actividad mensual, vistas por año y década de estreno.
- Aviso de aniversario ("hace un año viste...") y resumen anual estilo "wrapped".
- "¿Qué veo hoy?": elige al azar un título de tus pendientes.

**Perfiles**
- Varios usuarios en el mismo ordenador, cada uno con su propia lista, papelera, valoraciones,
  ajustes y copias de seguridad, totalmente independientes entre sí.
- Al abrir la app (o al cambiar de usuario) siempre se pregunta "¿Quién ve ahora?".
- Borrar un perfil no es definitivo: queda en "Perfiles eliminados" 30 días, listo para restaurarse
  con un clic sin perder ni una película.

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
│   │                           Vistas, Papelera, Recomendar, Ajustes) y los modales.
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

1. Ve a la [**última Release**](https://github.com/Gabriel-Luca07/peliculas-series-app/releases/latest)
   de este repositorio y descarga `Peliculas y Series Setup X.X.X.exe`.
2. Ejecútalo y sigue el asistente (puedes elegir la carpeta de instalación).
3. Al terminar, tendrás un acceso directo en el menú Inicio y, si lo marcaste, en el escritorio.

En esa misma Release también encontrarás una versión **portable**
(`Peliculas y Series X.X.X.exe`) que no requiere instalación: descárgala y ejecútala directamente.

> La aplicación funciona sin conexión para llevar tu lista, pero necesita una clave gratuita de
> TMDB para el autocompletado, pósters, tráilers, recomendaciones y próximos estrenos. Ver
> [Conectar con TMDB](#conectar-con-tmdb).

---

## Cómo actualizar la app sin perder tus datos

Tus películas, series, perfiles, valoraciones y copias de seguridad **no viven dentro de la
carpeta donde se instala la app**, sino en tu carpeta de usuario de Windows (ver
[Dónde se guardan tus datos](#dónde-se-guardan-tus-datos)). Instalar una versión nueva **no toca
esa carpeta para nada**, así que actualizar es seguro:

1. Ve a la [**última Release**](https://github.com/Gabriel-Luca07/peliculas-series-app/releases/latest)
   y descarga el instalador nuevo (`Peliculas y Series Setup X.X.X.exe`).
2. Ejecútalo igual que la primera vez, eligiendo la misma carpeta de instalación (el asistente la
   recuerda). El instalador reemplaza los archivos del programa, sin preguntar nada sobre tus
   datos porque no los toca.
3. Abre la app: tus perfiles, tu lista de pendientes/vistas y tus copias de seguridad siguen
   exactamente donde estaban.

Si usas la versión **portable** en vez de instalarla, simplemente sustituye el `.exe` antiguo por
el nuevo (o guarda el nuevo en otra carpeta y bórralo cuando compruebes que todo va bien) — como el
`.exe` portable no guarda nada dentro de sí mismo, tampoco hay riesgo de perder datos.

> **No hace falta** exportar ni hacer copia de seguridad manual antes de actualizar solo por el
> hecho de actualizar. Aun así, si quieres ir sobre seguro (por ejemplo, en el ordenador donde
> tienes toda tu colección metida), nunca está de más pulsar Ajustes → "Hacer copia ahora" antes de
> instalar la versión nueva.

**¿Cómo sé si tengo la última versión?** Ajustes muestra el número de versión instalada
(abajo del todo) — compáralo con el de la última Release en GitHub.

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
   tráiler, recomendaciones, próximos estrenos y el apartado Recomendar (que usa la parte de
   "descubrimiento" de las recomendaciones para armar tus listas para compartir).

Sin clave de TMDB la app sigue funcionando con normalidad para llevar tu lista de forma manual;
simplemente no tendrás esas funciones adicionales.

---

## Perfiles: varios usuarios en el mismo ordenador

Al abrir la app siempre aparece la pantalla "¿Quién ve ahora?" para elegir el perfil (o crear uno
nuevo si es la primera vez). Cada perfil tiene su propia lista, papelera, ajustes y copias de
seguridad — completamente independientes entre sí, como si cada uno tuviera su propia instalación
de la app dentro de la misma.

Puedes cambiar de perfil en cualquier momento con el botón de tu perfil (arriba a la izquierda),
que también da acceso a **"Gestionar perfiles"** para crear, renombrar o eliminar perfiles.

**Eliminar un perfil no es definitivo.** Para evitar borrados accidentales, hay que escribir el
nombre exacto del perfil para confirmar, y aun así el perfil no se borra al momento: queda
guardado en **"Perfiles eliminados"** (dentro de "Gestionar perfiles") durante 30 días, listo para
restaurarse con un clic, con toda su lista y sus copias de seguridad intactas. Pasado ese plazo se
borra en segundo plano automáticamente.

---

## Copias de seguridad: cómo funcionan y cómo restaurarlas

Las copias de seguridad son **por perfil**: si tienes varios perfiles, cada uno hace las suyas por
su cuenta con su propia configuración (activadas/desactivadas, días de retención), y restaurar una
copia en un perfil no afecta para nada a los demás.

### Automáticas

Activadas por defecto (Ajustes → Copia de seguridad y datos, dentro del perfil correspondiente).
Cada vez que activas ese perfil, si no existe ya una copia de hoy, se guarda una en su carpeta
`backups`, y se borran las que tengan más de N días (configurable, 14 por defecto). También puedes
forzar una copia en cualquier momento con el botón "Hacer copia ahora".

### Manuales

Los botones "Exportar" e "Importar" hacen lo mismo pero eligiendo tú el archivo y la ubicación
(útil para guardar una copia puntual en la nube o llevártela a otro ordenador).

### Cómo restaurar una copia

1. Ajustes → **"Abrir carpeta de copias"** para ver los archivos `backup-AAAA-MM-DD.json`
   disponibles (esto abre la carpeta correcta automáticamente, sea cual sea el ordenador).
2. Ajustes → **"Importar"** y selecciona el archivo que quieras restaurar.
3. Confirma el aviso: importar **reemplaza** tu lista actual por la del archivo, no la mezcla.

Esto solo restaura tu lista de películas/series; no afecta a la Papelera, a tus listas de
Recomendar ni a tus ajustes.

### Llevar tus datos a otro ordenador

Cada instalación es independiente: en un ordenador nuevo, la app empieza sin perfiles, sin
sincronizarse con las de otros ordenadores. Para trasladar tu lista, usa Exportar en el ordenador
de origen e Importar en el de destino (creando antes el mismo perfil), o copia manualmente la
carpeta del perfil completa de un ordenador a otro (ver más abajo) para llevarte también la
papelera, las copias y las listas de Recomendar.

---

## Dónde se guardan tus datos

Todo se guarda localmente, nunca en un servidor externo. Desde la versión con perfiles, cada
usuario tiene su propia subcarpeta:

```
%APPDATA%\peliculas-app\
├── profiles.json           Lista de perfiles (nombre, color) y cuál fue el último activo.
├── global-settings.json    Clave de TMDB (compartida entre perfiles).
├── deleted-profiles.json   Registro de los perfiles eliminados en los últimos 30 días.
├── deleted-profiles\       Carpetas de esos perfiles eliminados, a la espera de restaurarse.
└── profiles\
    └── <id-del-perfil>\
        ├── movies.json       Tu lista de películas y series.
        ├── trash.json        Papelera (elementos eliminados, purga automática a los 30 días).
        ├── settings.json     Idioma, región y preferencias de copia de seguridad de este perfil.
        ├── backups\          Copias de seguridad automáticas y manuales de este perfil.
        ├── share-lists.json  Historial de listas generadas en el apartado Recomendar.
        └── share-images\     Las imágenes PNG generadas para esas listas.
```

En Windows normalmente es `C:\Users\<tu usuario>\AppData\Roaming\peliculas-app\`. Puedes abrir la
carpeta del perfil activo directamente desde Ajustes → "Abrir carpeta de datos".

---

## Tecnologías

- [Electron](https://www.electronjs.org/) — empaqueta la app como aplicación de escritorio.
- HTML, CSS y JavaScript sin frameworks — toda la interfaz es "vanilla".
- [TMDB API](https://developer.themoviedb.org/docs) — metadatos, pósters, tráilers, recomendaciones y disponibilidad en plataformas.
- [electron-builder](https://www.electron.build/) — generación del instalador para Windows.
- Tipografía [Inter](https://rsms.me/inter/), empaquetada localmente.
