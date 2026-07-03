# Evals

Ejemplos dorados (golden) para las etapas con LLM: `extract` y `proposal`.

Vacio a proposito: el LLM todavia NO esta implementado. Cuando lo este, cada
eval compara la salida del modelo contra un JSON/markdown esperado a partir de
imagenes de tarjeta de ejemplo.

Estructura sugerida:

    evals/
      extract/
        <caso>/card_front.jpg
        <caso>/expected.json
      proposal/
        <caso>/lead.json
        <caso>/expected.md
