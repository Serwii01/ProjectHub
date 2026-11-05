// Lee el JSON que Claude Code pasa a los hooks por stdin
export async function leerEntrada() {
  let datos = "";
  for await (const trozo of process.stdin) datos += trozo;
  return datos.trim() ? JSON.parse(datos) : {};
}
