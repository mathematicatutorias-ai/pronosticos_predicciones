const $ = (id) => document.getElementById(id);

// ============================================================
// URLs
// ============================================================

const DEFAULT_CHRONOS_ONNX =
  "https://huggingface.co/TSFM-ai/chronos-2-onnx/resolve/main/model.onnx";

const DEFAULT_TIMESFM_ONNX =
  "https://huggingface.co/YangjieOu/timesfm-3.0-onnx/resolve/main/timesfm3-fp32-c128-h64.onnx";

const DEFAULT_TIMESFM_DATA =
  "https://huggingface.co/YangjieOu/timesfm-3.0-onnx/resolve/main/timesfm3-fp32-c128-h64.onnx.data";

const DEFAULT_TIMESFM_EXTERNAL_PATH =
  "timesfm3-fp32-c128-h64.onnx.data";


// Chronos-2 native quantiles.
const CHRONOS_QUANTILES = [
  0.01, 0.05, 0.10, 0.15, 0.20,
  0.25, 0.30, 0.35, 0.40, 0.45,
  0.50,
  0.55, 0.60, 0.65, 0.70, 0.75,
  0.80, 0.85, 0.90, 0.95, 0.99
];


// ============================================================
// ESTADO
// ============================================================

let plotState = {
  chronos: null,
  timesfm: null,
};


// ============================================================
// CONFIGURACIÓN ORT
// ============================================================

if (window.ort?.env?.wasm) {

  window.ort.env.wasm.wasmPaths =
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";

  window.ort.env.wasm.numThreads = Math.max(
    1,
    Math.min(
      4,
      navigator.hardwareConcurrency || 1
    )
  );

}


// ============================================================
// UI INICIAL
// ============================================================

$("chronosModelUrl").value =
  DEFAULT_CHRONOS_ONNX;

$("timesfmModelUrl").value =
  DEFAULT_TIMESFM_ONNX;

$("timesfmDataUrl").value =
  DEFAULT_TIMESFM_DATA;

$("timesfmExternalPath").value =
  DEFAULT_TIMESFM_EXTERNAL_PATH;


// ============================================================
// HELPERS
// ============================================================

function nowMs() {
  return performance.now();
}


function fmtMs(value) {

  if (!Number.isFinite(value)) {
    return "—";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }

  return `${value.toFixed(1)} ms`;

}


function mean(values) {

  if (!values.length) {
    return NaN;
  }

  return (
    values.reduce(
      (a, b) => a + b,
      0
    )
    / values.length
  );

}


function setState(
  prefix,
  state,
  text
) {

  const element =
    $(`${prefix}State`);

  element.textContent =
    text;

  element.classList.remove(
    "ok",
    "fail",
    "running"
  );

  if (state) {
    element.classList.add(
      state
    );
  }

}


function log(
  prefix,
  message,
  append = true
) {

  const element =
    $(`${prefix}Log`);

  if (append) {

    element.textContent +=
      (
        element.textContent
          ? "\n"
          : ""
      )
      + message;

  } else {

    element.textContent =
      message;

  }

  element.scrollTop =
    element.scrollHeight;

}


function errorText(error) {

  if (error instanceof Error) {

    return (
      `${error.name}: ${error.message}\n`
      + `${error.stack || ""}`
    );

  }

  return String(
    error
  );

}


function parseNumbers(text) {

  const trimmed =
    text.trim();

  if (!trimmed) {

    throw new Error(
      "La serie está vacía."
    );

  }


  // JSON:
  // [1,2,3]
  // o {"values":[1,2,3]}
  try {

    const parsed =
      JSON.parse(
        trimmed
      );

    const values =
      Array.isArray(parsed)
        ? parsed
        : parsed.values;

    if (
      Array.isArray(values)
    ) {

      const output =
        values
        .map(Number)
        .filter(Number.isFinite);

      if (output.length) {
        return output;
      }

    }

  } catch (_) {}


  // CSV / TXT
  const tokens =
    trimmed
    .replace(
      /[;\t]/g,
      ","
    )
    .split(
      /[\s,]+/
    )
    .map(Number)
    .filter(Number.isFinite);


  if (!tokens.length) {

    throw new Error(
      "No pude extraer números de la entrada."
    );

  }

  return tokens;

}


function currentSeries() {

  const values =
    parseNumbers(
      $("seriesInput").value
    );

  $("seriesCount").textContent =
    `${values.length} puntos`;

  return values;

}


// ============================================================
// PREPARACIÓN TIMESFM
// ============================================================

function context128(values) {

  if (
    values.length >= 128
  ) {

    return values.slice(
      -128
    );

  }


  const pad =
    new Array(
      128 - values.length
    )
    .fill(
      values[0]
    );

  return pad.concat(
    values
  );

}


// ============================================================
// PREPARACIÓN CHRONOS
//
// Interface TSFM-ai:
// context             float32[batch,512]
// group_ids           int64[batch]
// attention_mask      float32[batch,512]
// future_covariates   float32[batch,64]
// num_output_patches  int64[]
//
// Salida:
// quantile_preds      float32[batch,21,64]
// ============================================================

function makeChronosFeeds(values) {

  const actual =
    values.slice(
      -512
    );

  const padLength =
    512 - actual.length;


  // Faltantes a la izquierda = NaN.
  const context =
    new Float32Array(
      512
    );

  context.fill(
    NaN
  );


  // Mask:
  // 0 = padding
  // 1 = dato real
  const mask =
    new Float32Array(
      512
    );

  mask.fill(
    0
  );


  for (
    let i = 0;
    i < actual.length;
    i++
  ) {

    context[
      padLength + i
    ] = Number(
      actual[i]
    );

    mask[
      padLength + i
    ] = 1.0;

  }


  // No utilizamos covariables en este POC.
  // Este export reconoce valores faltantes;
  // marcamos los 64 pasos como NaN.
  const futureCovariates =
    new Float32Array(
      64
    );

  futureCovariates.fill(
    NaN
  );


  // Una única serie independiente.
  const groupIds =
    new BigInt64Array([
      0n
    ]);


  // 4 patches * 16 = 64 pasos.
  const numOutputPatches =
    new BigInt64Array([
      4n
    ]);


  return {

    context:
      new ort.Tensor(
        "float32",
        context,
        [1, 512]
      ),

    group_ids:
      new ort.Tensor(
        "int64",
        groupIds,
        [1]
      ),

    attention_mask:
      new ort.Tensor(
        "float32",
        mask,
        [1, 512]
      ),

    future_covariates:
      new ort.Tensor(
        "float32",
        futureCovariates,
        [1, 64]
      ),

    // Tensor escalar.
    num_output_patches:
      new ort.Tensor(
        "int64",
        numOutputPatches,
        []
      ),

  };

}


// ============================================================
// DECODIFICAR CHRONOS
//
// shape esperada:
// [1,21,64]
//
// q10 = índice 2
// q50 = índice 10
// q90 = índice 18
// ============================================================

function decodeChronosOutput(
  tensor
) {

  if (!tensor) {

    throw new Error(
      "Chronos no devolvió quantile_preds."
    );

  }


  const dims =
    tensor.dims.map(
      Number
    );

  const data =
    Array.from(
      tensor.data,
      Number
    );


  if (
    dims.length !== 3
    || dims[0] < 1
    || dims[1] < 21
    || dims[2] < 1
  ) {

    throw new Error(
      `Forma Chronos inesperada: [${dims.join(", ")}]`
    );

  }


  const nq =
    dims[1];

  const horizon =
    dims[2];


  const q10 = [];
  const q50 = [];
  const q90 = [];


  // layout [batch, quantile, horizon]
  function valueAt(
    qIndex,
    hIndex
  ) {

    return data[
      qIndex * horizon
      + hIndex
    ];

  }


  for (
    let h = 0;
    h < horizon;
    h++
  ) {

    q10.push(
      valueAt(
        2,
        h
      )
    );

    q50.push(
      valueAt(
        10,
        h
      )
    );

    q90.push(
      valueAt(
        18,
        h
      )
    );

  }


  return {
    q10,
    q50,
    q90,
    dims,
    quantiles:
      CHRONOS_QUANTILES,
  };

}


// ============================================================
// DECODIFICAR TIMESFM
//
// shape esperada:
// [1,1,64,9]
//
// q10 = 0
// q50 = 4
// q90 = 8
// ============================================================

function decodeTimesfmOutput(
  tensor
) {

  if (!tensor) {

    throw new Error(
      "TimesFM no devolvió forecast_quantiles."
    );

  }


  const dims =
    tensor.dims.map(
      Number
    );

  const data =
    Array.from(
      tensor.data,
      Number
    );


  if (
    dims.length !== 4
    || dims[0] < 1
    || dims[1] < 1
    || dims[2] < 1
    || dims[3] < 9
  ) {

    throw new Error(
      `Forma TimesFM inesperada: [${dims.join(", ")}]`
    );

  }


  const horizon =
    dims[2];

  const nq =
    dims[3];


  const q10 = [];
  const q50 = [];
  const q90 = [];


  for (
    let h = 0;
    h < horizon;
    h++
  ) {

    const offset =
      h * nq;

    q10.push(
      data[
        offset + 0
      ]
    );

    q50.push(
      data[
        offset + 4
      ]
    );

    q90.push(
      data[
        offset + 8
      ]
    );

  }


  return {
    q10,
    q50,
    q90,
    dims,
  };

}


// ============================================================
// DETECTAR WEBGPU
// ============================================================

async function detectWebGPU() {

  const ua =
    navigator.userAgent;


  $("browserStatus").textContent =
    ua.match(/Edg\//)
      ? "Edge"
      : ua.match(/Chrome\//)
        ? "Chrome"
        : "Otro";


  if (!navigator.gpu) {

    $("gpuStatus").textContent =
      "NO DISPONIBLE";

    $("gpuInfo").textContent =
      "navigator.gpu no existe";

    $("webgpuBadge").textContent =
      "WebGPU no disponible";

    $("webgpuBadge").classList.add(
      "fail"
    );

    return;

  }


  try {

    const adapter =
      await navigator.gpu.requestAdapter({
        powerPreference:
          "high-performance",
      });


    if (!adapter) {

      throw new Error(
        "requestAdapter() devolvió null."
      );

    }


    let label =
      "GPU detectada";


    try {

      const info =
        adapter.info;

      const parts = [

        info?.vendor,
        info?.architecture,
        info?.device,
        info?.description,

      ].filter(Boolean);


      if (parts.length) {

        label =
          parts.join(
            " · "
          );

      }

    } catch (_) {}


    $("gpuStatus").textContent =
      "DISPONIBLE";

    $("gpuInfo").textContent =
      label;

    $("webgpuBadge").textContent =
      "WebGPU listo";

    $("webgpuBadge").classList.add(
      "ok"
    );


  } catch (error) {


    $("gpuStatus").textContent =
      "ERROR";

    $("gpuInfo").textContent =
      errorText(
        error
      ).split("\n")[0];

    $("webgpuBadge").textContent =
      "WebGPU con error";

    $("webgpuBadge").classList.add(
      "fail"
    );

  }

}


// ============================================================
// PLOT
// ============================================================

function updatePlot() {

  const values =
    currentSeries();

  const displayHorizon =
    Number(
      $("displayHorizon").value
    );


  const xObserved =
    Array.from(
      {
        length:
          values.length
      },
      (_, i) =>
        i - values.length + 1
    );


  const traces = [

    {
      x:
        xObserved,

      y:
        values,

      type:
        "scatter",

      mode:
        "lines",

      name:
        "Observado",

      line: {
        width:
          3
      },

      hovertemplate:
        "t=%{x}<br>"
        + "Observado: %{y:.4f}"
        + "<extra></extra>",
    },

  ];


  function addForecast(
    label,
    result,
    dash
  ) {

    if (
      !result?.q50?.length
    ) {

      return;

    }


    const n =
      Math.min(
        displayHorizon,
        result.q50.length
      );


    const x =
      Array.from(
        {
          length:
            n
        },
        (_, i) =>
          i + 1
      );


    traces.push({

      x:
        x,

      y:
        result.q90.slice(
          0,
          n
        ),

      type:
        "scatter",

      mode:
        "lines",

      name:
        `${label} q90`,

      line: {
        width:
          0
      },

      hoverinfo:
        "skip",

      showlegend:
        false,

    });


    traces.push({

      x:
        x,

      y:
        result.q10.slice(
          0,
          n
        ),

      type:
        "scatter",

      mode:
        "lines",

      name:
        `${label} q10`,

      line: {
        width:
          0
      },

      fill:
        "tonexty",

      opacity:
        0.10,

      hoverinfo:
        "skip",

      showlegend:
        false,

    });


    traces.push({

      x:
        x,

      y:
        result.q50.slice(
          0,
          n
        ),

      type:
        "scatter",

      mode:
        "lines",

      name:
        `${label} q50`,

      line: {
        width:
          2.5,
        dash:
          dash
      },

      hovertemplate:
        `${label}: %{y:.4f}`
        + "<extra></extra>",

    });

  }


  addForecast(
    "Chronos-2",
    plotState.chronos,
    "dash"
  );


  addForecast(
    "TimesFM-3",
    plotState.timesfm,
    "dot"
  );


  Plotly.react(

    "chart",

    traces,

    {

      template:
        "plotly_white",

      height:
        500,

      margin: {
        l:
          55,
        r:
          20,
        t:
          25,
        b:
          45,
      },

      hovermode:
        "x unified",

      xaxis: {

        title:
          "Pasos relativos · forecast > 0",

        zeroline:
          true,

        zerolinewidth:
          1.5,

      },

      yaxis: {
        title:
          "Valor"
      },

      legend: {
        orientation:
          "h",
        y:
          1.08,
      },

    },

    {
      responsive:
        true,
      displaylogo:
        false,
    }

  );

}


// ============================================================
// CHRONOS DIRECTO
// ============================================================

async function runChronos() {

  const button =
    $("runChronosBtn");

  button.disabled =
    true;


  setState(
    "chronos",
    "running",
    "EJECUTANDO"
  );


  log(
    "chronos",
    "",
    false
  );


  let session =
    null;


  try {

    if (!window.ort) {

      throw new Error(
        "ONNX Runtime Web no se cargó."
      );

    }


    const values =
      currentSeries();

    const backend =
      $("backend").value;

    const benchRuns =
      Number(
        $("benchRuns").value
      );

    const modelUrl =
      $("chronosModelUrl")
      .value
      .trim();


    if (
      backend === "webgpu"
      && !navigator.gpu
    ) {

      throw new Error(
        "WebGPU no está disponible."
      );

    }


    $("chronosBackend").textContent =
      backend;


    log(
      "chronos",
      `Backend: ${backend}`
    );

    log(
      "chronos",
      `Contexto recibido: ${values.length} puntos`
    );

    log(
      "chronos",
      "Contexto ONNX: [1,512]"
    );

    log(
      "chronos",
      `ONNX: ${modelUrl}`
    );

    log(
      "chronos",
      "Modelo FP32 ~456 MB"
    );

    log(
      "chronos",
      "Descargando/cargando modelo…"
    );


    const t0 =
      nowMs();


    session =
      await ort.InferenceSession.create(

        modelUrl,

        {

          executionProviders:
            [
              backend
            ],

          graphOptimizationLevel:
            "all",

        }

      );


    const loadMs =
      nowMs()
      - t0;


    $("chronosLoad").textContent =
      fmtMs(
        loadMs
      );


    log(
      "chronos",
      `Sesión creada en ${fmtMs(loadMs)}`
    );


    log(
      "chronos",
      `Inputs: ${session.inputNames.join(", ")}`
    );


    log(
      "chronos",
      `Outputs: ${session.outputNames.join(", ")}`
    );


    const feeds =
      makeChronosFeeds(
        values
      );


    const times =
      [];


    let decoded =
      null;


    for (
      let i = 0;
      i < benchRuns;
      i++
    ) {


      const ti =
        nowMs();


      const outputs =
        await session.run(
          feeds
        );


      const elapsed =
        nowMs()
        - ti;


      times.push(
        elapsed
      );


      const tensor =
        outputs.quantile_preds
        ??
        outputs[
          session.outputNames[0]
        ];


      decoded =
        decodeChronosOutput(
          tensor
        );


      log(
        "chronos",
        `Inferencia ${i + 1}/${benchRuns}: ${fmtMs(elapsed)}`
      );

    }


    $("chronosInfer").textContent =
      fmtMs(
        times[0]
      );


    const warm =
      (
        times.length > 1
          ? times.slice(1)
          : times
      );


    $("chronosWarm").textContent =
      fmtMs(
        mean(
          warm
        )
      );


    plotState.chronos =
      decoded;


    updatePlot();


    log(
      "chronos",
      `Forma salida: [${decoded.dims.join(", ")}]`
    );


    log(
      "chronos",
      `q50 primeros 5: ${
        decoded.q50
        .slice(0, 5)
        .map(
          v => Number(v).toFixed(5)
        )
        .join(", ")
      }`
    );


    setState(
      "chronos",
      "ok",
      "PASS"
    );


  } catch (error) {


    setState(
      "chronos",
      "fail",
      "FAIL"
    );


    log(
      "chronos",
      "\nERROR\n"
      + errorText(
        error
      )
    );


    console.error(
      error
    );


  } finally {


    if (session) {

      try {

        await session.release();

      } catch (_) {}

    }


    button.disabled =
      false;

  }

}


// ============================================================
// TIMESFM
// ============================================================

async function runTimesfm() {

  const button =
    $("runTimesfmBtn");

  button.disabled =
    true;


  setState(
    "timesfm",
    "running",
    "EJECUTANDO"
  );


  log(
    "timesfm",
    "",
    false
  );


  let session =
    null;


  try {

    if (!window.ort) {

      throw new Error(
        "ONNX Runtime Web no se cargó."
      );

    }


    const values =
      currentSeries();

    const context =
      context128(
        values
      );

    const backend =
      $("backend").value;

    const benchRuns =
      Number(
        $("benchRuns").value
      );


    if (
      backend === "webgpu"
      && !navigator.gpu
    ) {

      throw new Error(
        "WebGPU no está disponible."
      );

    }


    const modelUrl =
      $("timesfmModelUrl")
      .value
      .trim();


    const dataUrl =
      $("timesfmDataUrl")
      .value
      .trim();


    const externalPath =
      $("timesfmExternalPath")
      .value
      .trim();


    $("timesfmBackend").textContent =
      backend;


    log(
      "timesfm",
      `Backend: ${backend}`
    );


    log(
      "timesfm",
      `Contexto: ${context.length} puntos`
    );


    log(
      "timesfm",
      `ONNX: ${modelUrl}`
    );


    log(
      "timesfm",
      `External data: ${dataUrl}`
    );


    log(
      "timesfm",
      "FP32 ~1.3 GB"
    );


    log(
      "timesfm",
      "Descargando/cargando modelo…"
    );


    const t0 =
      nowMs();


    session =
      await ort.InferenceSession.create(

        modelUrl,

        {

          executionProviders:
            [
              backend
            ],

          graphOptimizationLevel:
            "all",

          externalData:
            [
              {
                path:
                  externalPath,

                data:
                  dataUrl,
              }
            ],

        }

      );


    const loadMs =
      nowMs()
      - t0;


    $("timesfmLoad").textContent =
      fmtMs(
        loadMs
      );


    log(
      "timesfm",
      `Sesión creada en ${fmtMs(loadMs)}`
    );


    log(
      "timesfm",
      `Inputs: ${session.inputNames.join(", ")}`
    );


    log(
      "timesfm",
      `Outputs: ${session.outputNames.join(", ")}`
    );


    const target =
      new ort.Tensor(

        "float32",

        Float32Array.from(
          context
        ),

        [
          1,
          1,
          128
        ]

      );


    const times =
      [];


    let decoded =
      null;


    for (
      let i = 0;
      i < benchRuns;
      i++
    ) {


      const ti =
        nowMs();


      const outputs =
        await session.run({
          target:
            target
        });


      const elapsed =
        nowMs()
        - ti;


      times.push(
        elapsed
      );


      const tensor =
        outputs.forecast_quantiles
        ??
        outputs[
          session.outputNames[0]
        ];


      decoded =
        decodeTimesfmOutput(
          tensor
        );


      log(
        "timesfm",
        `Inferencia ${i + 1}/${benchRuns}: ${fmtMs(elapsed)}`
      );

    }


    $("timesfmInfer").textContent =
      fmtMs(
        times[0]
      );


    const warm =
      (
        times.length > 1
          ? times.slice(1)
          : times
      );


    $("timesfmWarm").textContent =
      fmtMs(
        mean(
          warm
        )
      );


    plotState.timesfm =
      decoded;


    updatePlot();


    log(
      "timesfm",
      `Forma salida: [${decoded.dims.join(", ")}]`
    );


    log(
      "timesfm",
      `q50 primeros 5: ${
        decoded.q50
        .slice(0, 5)
        .map(
          v => Number(v).toFixed(5)
        )
        .join(", ")
      }`
    );


    setState(
      "timesfm",
      "ok",
      "PASS"
    );


  } catch (error) {


    setState(
      "timesfm",
      "fail",
      "FAIL"
    );


    log(
      "timesfm",
      "\nERROR\n"
      + errorText(
        error
      )
    );


    console.error(
      error
    );


  } finally {


    if (session) {

      try {

        await session.release();

      } catch (_) {}

    }


    button.disabled =
      false;

  }

}


// ============================================================
// DEMO / FILES
// ============================================================

async function loadDemo() {

  const response =
    await fetch(
      "./data/demo_series.json"
    );


  if (!response.ok) {

    throw new Error(
      `No pude abrir demo_series.json (${response.status}).`
    );

  }


  const data =
    await response.json();


  const values =
    data.values.map(
      Number
    );


  $("seriesInput").value =
    JSON.stringify(
      values
    );


  $("seriesCount").textContent =
    `${values.length} puntos`;


  plotState = {
    chronos:
      null,
    timesfm:
      null,
  };


  updatePlot();

}


async function loadFile(
  file
) {

  const text =
    await file.text();


  const values =
    parseNumbers(
      text
    );


  $("seriesInput").value =
    JSON.stringify(
      values
    );


  $("seriesCount").textContent =
    `${values.length} puntos`;


  plotState = {
    chronos:
      null,
    timesfm:
      null,
  };


  updatePlot();

}


// ============================================================
// EVENTOS
// ============================================================

$("runChronosBtn")
.addEventListener(
  "click",
  runChronos
);


$("runTimesfmBtn")
.addEventListener(
  "click",
  runTimesfm
);


$("loadDemoBtn")
.addEventListener(
  "click",
  loadDemo
);


$("clearBtn")
.addEventListener(
  "click",
  () => {

    plotState = {
      chronos:
        null,
      timesfm:
        null,
    };

    updatePlot();

  }
);


$("seriesFile")
.addEventListener(
  "change",
  async event => {

    const file =
      event.target.files?.[0];


    if (!file) {
      return;
    }


    try {

      await loadFile(
        file
      );

    } catch (error) {

      alert(
        errorText(
          error
        )
      );

    }

  }
);


$("seriesInput")
.addEventListener(
  "change",
  () => {

    try {

      updatePlot();

    } catch (_) {}

  }
);


$("displayHorizon")
.addEventListener(
  "change",
  updatePlot
);


// ============================================================
// START
// ============================================================

await detectWebGPU();


try {

  await loadDemo();

} catch (error) {

  console.error(
    error
  );

  $("seriesInput").value =
    "55,55.2,55.4,55.1";

}
