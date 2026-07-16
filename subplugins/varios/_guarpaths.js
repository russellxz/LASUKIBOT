// Rutas de almacenamiento local por subbot (guar / stickers).
// Cada subbot guarda su multimedia en su propia carpeta subbots/data/<num>/,
// así ningún subbot comparte los paquetes con otro ni con el bot principal.
import path from 'path';

export function guarBase(conn) {
  return conn && conn.subDataDir ? conn.subDataDir : process.cwd();
}

export function guarPaths(conn) {
  const base = guarBase(conn);
  return {
    base,
    guarJson: path.join(base, "guar.json"),
    guar2Json: path.join(base, "guar2.json"),
    filesDb: path.join(base, "guar_files.json"),
    mediaRoot: path.join(base, "guar_media"),
    packsDb: path.join(base, "guars_packs.json")
  };
}
