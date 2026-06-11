export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    try {
      if (url.pathname === "/api/ping") {
        return json({ ok: true, message: "pong" }, 200, request);
      }

      if (url.pathname === "/api/getData" && request.method === "GET") {
        return json(await getData(env), 200, request);
      }

      if (url.pathname === "/api/buscarPersonaPorDni" && request.method === "GET") {
        const dni = url.searchParams.get("dni");
        const idTurno = url.searchParams.get("id_turno");
        return json(await buscarPersonaPorDni(env, dni, idTurno), 200, request);
      }

      if (url.pathname === "/api/misTurnos" && request.method === "POST") {
        const body = await request.json();
        return json(await misTurnos(env, body), 200, request);
      }

      if (url.pathname === "/api/inscribir" && request.method === "POST") {
        const body = await request.json();
        return json(await inscribir(env, body, ctx), 200, request);
      }

      if (url.pathname === "/api/cambiar" && request.method === "POST") {
        const body = await request.json();
        return json(await cambiar(env, body, ctx), 200, request);
      }

      if (url.pathname === "/api/borrar" && request.method === "POST") {
        const body = await request.json();
        return json(await borrar(env, body, ctx), 200, request);
      }

      if (url.pathname === "/api/getAdminData" && request.method === "POST") {
        const body = await request.json();
        return json(await getAdminData(env, body.pwd), 200, request);
      }

      if (url.pathname === "/api/getEmailLogs" && request.method === "POST") {
        const body = await request.json();
        return json(await getEmailLogs(env, body.pwd, body.limit || "100"), 200, request);
      }

      if (url.pathname === "/api/reenviarEmail" && request.method === "POST") {
        const body = await request.json();
        return json(await reenviarEmail(env, body, ctx), 200, request);
      }

      return json({
        ok: false,
        errorCode: "routeNotFound",
        error: "Ruta no encontrada",
        path: url.pathname,
        method: request.method
      }, 404, request);

    } catch (err) {
      console.error("Worker error:", err);

      const isAppError = Boolean(err?.errorCode);

      return json({
        ok: false,
        errorCode: err?.errorCode || "serverError",
        error: isAppError ? err.message : "Error interno del servidor"
      }, isAppError ? 400 : 500, request);
    }
  }
};

// ------------------------------------------------------------
// Configuración HTTP / CORS
// ------------------------------------------------------------

const ALLOWED_ORIGINS = [
  "https://tafallaikastola.github.io"
];

function corsHeaders(request) {
	const origin = request?.headers?.get("Origin") || "";

	if (!ALLOWED_ORIGINS.includes(origin)) {
		return {
			"Vary": "Origin"
		};
	}

	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
		"Vary": "Origin"
	};
}

function json(data, status = 200, request = null) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

// ------------------------------------------------------------
// Base de datos
// ------------------------------------------------------------

function db(env) {
	return env.barraka_db || env.DB;
}

// ------------------------------------------------------------
// Helpers básicos
// ------------------------------------------------------------

function texto(value) {
  return String(value ?? "").trim();
}

function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizarNombre(nombre) {
  return String(nombre || "").trim().toUpperCase();
}

function normalizarDni(dni) {
	return String(dni || "")
		.toUpperCase()
		.replace(/[^0-9A-Z]/g, "");
}

function dniSinLetra(dni) {
	return normalizarDni(dni).replace(/[A-Z]$/, "");
}

function yesNo(value) {
  const v = String(value || "").trim().toLowerCase();
  return ["si", "sí", "s", "true", "1", "yes"].includes(v) ? "si" : "no";
}

function isYes(value) {
  return yesNo(value) === "si";
}

function uniqueId() {
  return crypto.randomUUID();
}

function appError(errorCode, message) {
  const err = new Error(message);
  err.errorCode = errorCode;
  return err;
}

// ------------------------------------------------------------
// Validaciones
// ------------------------------------------------------------

function isValidEmail(email) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function isValidDniNie(dni) {
	const value = normalizarDni(dni);
	const letters = "TRWAGMYFPDXBNJZSQVHLCKE";

	let numberPart = "";
	let letter = "";

	if (/^[0-9]{8}[A-Z]$/.test(value)) {
		numberPart = value.slice(0, 8);
		letter = value.slice(8);
	} else if (/^[XYZ][0-9]{7}[A-Z]$/.test(value)) {
		const prefixMap = { X: "0", Y: "1", Z: "2" };
		numberPart = prefixMap[value[0]] + value.slice(1, 8);
		letter = value.slice(8);
	} else {
		return false;
	}

	return letters[Number(numberPart) % 23] === letter;
}

function isValidName(nombre) {
	const value = String(nombre || "").trim();
	return value.length >= 2 && /^[a-zA-ZÀ-ÿ\u00f1\u00d1çÇ\s.'-]+$/.test(value);
}

function requireFields(body, fields) {
  for (const field of fields) {
    if (!texto(body?.[field])) {
      throw appError("missingFields", `Falta el campo ${field}.`);
    }
  }
}

function requirePersonFields(person, index) {
  if (!texto(person.nombre)) {
    throw appError("missingPersonName", `Falta el nombre de la persona ${index + 1}.`);
  }

  if (!texto(person.dni)) {
    throw appError("missingPersonDni", `Falta el DNI de la persona ${index + 1}.`);
  }
}

function validatePersonData(person, index = 0) {
	const label = index === 0 ? "principal" : `adicional ${index}`;

	if (!isValidName(person.nombre)) {
		throw appError("invalidName", `El nombre de la persona ${label} no es válido.`);
	}

	if (!isValidDniNie(person.dni)) {
		throw appError("invalidDni", `El DNI/NIE de la persona ${label} no es válido.`);
	}
}

function assertNoDuplicatesInRequest(personas) {
  const seen = new Set();

  for (const person of personas) {
    const key = dniSinLetra(person.dni);

    if (!key) {
      throw appError("invalidDni", "Hay un DNI no válido.");
    }

    if (seen.has(key)) {
      throw appError("duplicateInRequest", "Hay personas repetidas en la solicitud.");
    }

    seen.add(key);
  }
}

function identityMatchesByDni(row, body) {
  const a = dniSinLetra(row?.dni);
  const b = dniSinLetra(body?.dni);

  return Boolean(a && b && a === b);
}

// ------------------------------------------------------------
// Fechas, SQL y conversión para cliente
// ------------------------------------------------------------

function fechaParaCliente(value) {
	if (value === null || value === undefined) return "";

	const raw = String(value).trim();
	if (!raw) return "";

	let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
	if (match) {
		const [, y, m, d] = match;
		return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
	}

	match = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
	if (match) {
		const [, d, m, y] = match;
		return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
	}

	return raw;
}

function dniSqlExpr(columnName = "dni") {
  return `
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(UPPER(${columnName}), '-', ''),
        ' ', ''),
      '.', ''),
    '/', '')
  `;
}

function turnoParaCliente(row) {
  return {
    ...row,
    id_turno: row.id_turno || row.id,
    fecha: fechaParaCliente(row.fecha),
    plazas: Number(row.plazas || 0),
    plazas_responsable: Number(row.plazas_responsable || 0),
    plazas_ocupadas: Number(row.plazas_ocupadas ?? row.ocupadas ?? 0),
    plazas_responsable_ocupadas: Number(row.plazas_responsable_ocupadas ?? row.ocupadas_responsable ?? 0),
    inscritos: Array.isArray(row.inscritos) ? row.inscritos : []
  };
}

// ------------------------------------------------------------
// Datos públicos
// ------------------------------------------------------------

async function getData(env) {
  const database = db(env);

  if (!database) {
    return {
      ok: false,
      errorCode: "serverError",
      error: "No hay binding D1",
      bindings: Object.keys(env)
    };
  }

  const turnosResult = await database.prepare(`
    SELECT
      t.id,
      t.id AS id_turno,
      t.fecha,
      t.tipo,
      t.hora_inicio,
      t.hora_fin,
      t.plazas,
      t.plazas_responsable,
      t.activo,

      SUM(CASE
        WHEN i.estado = 'activa'
        THEN 1 ELSE 0
      END) AS plazas_ocupadas,

      SUM(CASE
        WHEN i.estado = 'activa'
         AND COALESCE(i.es_responsable, 0) = 1
        THEN 1 ELSE 0
      END) AS plazas_responsable_ocupadas

    FROM turnos t
    LEFT JOIN inscripciones i
      ON i.id_turno = t.id
    WHERE t.activo = 1
    GROUP BY t.id
    ORDER BY t.fecha, t.hora_inicio, t.tipo
  `).all();

  const inscritosResult = await database.prepare(`
    SELECT
      id_turno,
      nombre,
      es_responsable,
      publicar_nombre,
      fecha_creacion
    FROM inscripciones
    WHERE estado = 'activa'
    ORDER BY fecha_creacion ASC
  `).all();

  const inscritosPorTurno = {};

  for (const row of inscritosResult.results || []) {
    const idTurno = row.id_turno;
    if (!inscritosPorTurno[idTurno]) inscritosPorTurno[idTurno] = [];

    const numeroPrivado = inscritosPorTurno[idTurno].filter(p => p.publicar_nombre === "no").length + 1;
    const publicarNombre = yesNo(row.publicar_nombre);

    inscritosPorTurno[idTurno].push({
      nombre: publicarNombre === "si"
        ? String(row.nombre || "").trim()
        : `Privado ${numeroPrivado}`,
      responsable_turno: Number(row.es_responsable || 0) === 1 ? "si" : "no",
      publicar_nombre: publicarNombre
    });
  }

  const turnos = (turnosResult.results || []).map(row => {
    const turno = turnoParaCliente(row);
    const inscritos = inscritosPorTurno[turno.id_turno] || [];

    const plazas = Number(turno.plazas || 0);
    const plazasResponsable = Number(turno.plazas_responsable || 0);
    const plazasOcupadas = inscritos.length;
    const responsablesOcupadas = inscritos.filter(p => p.responsable_turno === "si").length;

    return {
      ...turno,
      inscritos,
      plazas_ocupadas: plazasOcupadas,
      plazas_disponibles: Math.max(plazas - plazasOcupadas, 0),
      plazas_responsable_ocupadas: responsablesOcupadas,
      plazas_responsable_disponibles: Math.max(plazasResponsable - responsablesOcupadas, 0),
      permite_responsable_turno: responsablesOcupadas < plazasResponsable
    };
  });

  return {
    ok: true,
    turnos,
    opciones: await getOpciones(env)
  };
}

async function getOpciones(env) {
  const database = db(env);

  if (!database) {
    return {};
  }

  const result = await database.prepare(`
    SELECT clave, valor
    FROM opciones
    WHERE clave IS NOT NULL
      AND valor IS NOT NULL
      AND TRIM(clave) != ''
      AND TRIM(valor) != ''
    ORDER BY clave, valor
  `).all();

  const opciones = {};

  for (const row of result.results || []) {
    const clave = String(row.clave || "").trim();
    const valor = String(row.valor || "").trim();

    if (!clave || !valor) continue;

    if (!opciones[clave]) {
      opciones[clave] = [];
    }

    opciones[clave].push(valor);
  }

  return opciones;
}

async function buscarPersonaPorDni(env, dni, idTurno) {
	const database = db(env);
	const dniKey = dniSinLetra(dni);

	if (!isValidDniNie(dni)) {
		throw appError("invalidDni", "DNI/NIE no válido.");
	}

	if (!database) {
		return { ok: false, errorCode: "serverError", error: "No hay binding D1" };
	}

	if (!dniKey) {
		return { ok: false, errorCode: "notdata", error: "Falta DNI." };
	}

	const persona = await database.prepare(`
    SELECT
      dni,
      nombre,
      email,
      'personas' AS origen
    FROM personas
    WHERE
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(UPPER(dni), '-', ''),
          ' ', ''),
        '.', ''),
      '/', '') LIKE ?
    LIMIT 1
  `).bind(`${dniKey}%`).first();

	let personaAnterior = null;

	if (!persona) {
		try {
			personaAnterior = await database.prepare(`
        SELECT
          dni,
          nombre,
          email,
          'personas_anteriores' AS origen
        FROM personas_anteriores
        WHERE
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(UPPER(dni), '-', ''),
              ' ', ''),
            '.', ''),
          '/', '') LIKE ?
        LIMIT 1
      `).bind(`${dniKey}%`).first();
		} catch (err) {
			personaAnterior = null;
		}
	}

	let inscripcion = null;

	if (idTurno) {
		inscripcion = await database.prepare(`
      SELECT
        id,
        id AS id_inscripcion,
        id_turno,
        dni,
        nombre,
        email,
        es_responsable,
        estado,
        fecha_creacion
      FROM inscripciones
      WHERE id_turno = ?
        AND estado = 'activa'
        AND
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(UPPER(dni), '-', ''),
              ' ', ''),
            '.', ''),
          '/', '') LIKE ?
      LIMIT 1
    `).bind(idTurno, `${dniKey}%`).first();
	}

	const encontrada = persona || personaAnterior;

	return {
		ok: true,
		found: Boolean(encontrada),
		alreadyRegistered: Boolean(inscripcion),
		persona: encontrada || null,
		inscripcion: inscripcion || null
	};
}

async function misTurnos(env, body) {
  const database = db(env);
  const dniKey = dniSinLetra(body?.dni);

	if (!isValidDniNie(body?.dni)) {
		throw appError("invalidDni", "DNI/NIE no válido.");
	}

  if (!database) {
    return { ok: false, errorCode: "serverError", error: "No hay binding D1" };
  }

  if (!dniKey) {
    throw appError("notdata", "Falta DNI.");
  }

  const result = await database.prepare(`
    WITH propias AS (
      SELECT id
      FROM inscripciones
      WHERE estado = 'activa'
        AND ${dniSqlExpr("dni")} LIKE ?
    )
    SELECT
      i.id,
      i.id AS id_inscripcion,
      i.id_inscripcion_gestor,
      i.id_turno,
      i.dni,
      i.nombre,
      i.email,
      i.gela,
      i.es_responsable,
      CASE
        WHEN COALESCE(i.es_responsable, 0) = 1 THEN 'si'
        ELSE 'no'
      END AS responsable_turno,
      i.publicar_nombre,
      i.estado,
      i.fecha_creacion,

      t.id AS turno_id,
      t.fecha,
      t.tipo,
      t.hora_inicio,
      t.hora_fin,
      t.plazas,
      t.plazas_responsable,
      t.activo

    FROM inscripciones i
    JOIN turnos t
      ON t.id = i.id_turno
    WHERE i.estado = 'activa'
      AND (
        ${dniSqlExpr("i.dni")} LIKE ?
        OR i.id_inscripcion_gestor IN (SELECT id FROM propias)
      )
    ORDER BY t.fecha, t.hora_inicio, t.tipo, i.fecha_creacion
  `).bind(`${dniKey}%`, `${dniKey}%`).all();

  const inscripciones = (result.results || []).map(row => ({
    ...row,
    fecha: fechaParaCliente(row.fecha),
    id_inscripcion: row.id_inscripcion || row.id,
    id_turno: row.id_turno || row.turno_id,
    responsable_turno: row.responsable_turno || (Number(row.es_responsable) ? "si" : "no")
  }));

  return {
    ok: true,
    inscripciones
  };
}

// ------------------------------------------------------------
// Inscripción
// ------------------------------------------------------------

async function inscribir(env, body, ctx) {
  const database = db(env);

  if (!database) {
    return { ok: false, errorCode: "serverError", error: "No hay binding D1" };
  }

  requireFields(body, ["id_turno", "nombre", "dni"]);

  const idTurno = texto(body.id_turno);
  const idGestorExistente = texto(body.id_inscripcion_gestor);
  const publicarNombre = yesNo(body.publicar_nombre);
  const responsableTurno = yesNo(body.responsable_turno);
  let email = normalizarEmail(body.email);

  const turno = await database.prepare(`
    SELECT
      id,
      fecha,
      tipo,
      hora_inicio,
      hora_fin,
      plazas,
      plazas_responsable,
      activo
    FROM turnos
    WHERE id = ?
      AND activo = 1
    LIMIT 1
  `).bind(idTurno).first();

  if (!turno) {
    throw appError("shiftNotFound", "No se ha encontrado el turno o no está activo.");
  }

  let gestor = null;

  if (idGestorExistente) {
    gestor = await database.prepare(`
      SELECT
        id,
        id AS id_inscripcion,
        id_inscripcion_gestor,
        id_turno,
        dni,
        nombre,
        email,
        estado
      FROM inscripciones
      WHERE id = ?
        AND estado = 'activa'
      LIMIT 1
    `).bind(idGestorExistente).first();

    if (!gestor) {
      throw appError("managerNotFound", "No se ha encontrado esa inscripción activa.");
    }

    if (!identityMatchesByDni(gestor, {
      dni: body.gestor_dni || body.dni
    })) {
      throw appError("noPermission", "No tienes permiso para gestionar esta inscripción.");
    }

    email = normalizarEmail(gestor.email);
  } else if (!email) {
    throw appError("missingMainEmail", "Falta el campo email en la persona principal.");
  }


  const adicionales = Array.isArray(body.personas_adicionales)
    ? body.personas_adicionales
    : [];

  const personas = [
    {
      nombre: body.nombre,
      email,
      dni: body.dni,
      gela: body.gela,
      responsable_turno: idGestorExistente ? "no" : responsableTurno,
      publicar_nombre: publicarNombre
    },
    ...adicionales.map(p => ({
      nombre: p.nombre,
      email,
      dni: p.dni,
      gela: p.gela,
      responsable_turno: "no",
      publicar_nombre: publicarNombre
    }))
  ];

	personas.forEach((p, i) => {
		requirePersonFields(p, i);
		validatePersonData(p, i);
	});

	if (!idGestorExistente && !isValidEmail(email)) {
		throw appError("invalidEmail", "El email no es válido.");
	}
  assertNoDuplicatesInRequest(personas);

  const normalDnis = personas.map(p => dniSinLetra(p.dni));
  const placeholders = normalDnis.map(() => "?").join(",");

  const existentes = await database.prepare(`
    SELECT
      dni,
      nombre
    FROM inscripciones
    WHERE id_turno = ?
      AND estado = 'activa'
      AND substr(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(UPPER(dni), '-', ''),
            ' ', ''),
          '.', ''),
        '/',	''),
        1,
        length(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(UPPER(dni), '-', ''),
              ' ', ''),
            '.', ''),
          '/', '')
        ) - 1
      ) IN (${placeholders})
  `).bind(idTurno, ...normalDnis).all();

  if ((existentes.results || []).length) {
    throw appError("alreadyRegistered", "Alguna de las personas ya está apuntada a este turno.");
  }

await assertNoOverlappingShifts(database, personas, turno);

	const responsablesSolicitados = personas.filter(p => isYes(p.responsable_turno)).length;

	if (responsablesSolicitados > 0 && Number(turno.plazas_responsable || 0) <= 0) {
		throw appError("noResponsibleCapacity", "Este turno no admite responsable.");
	}
	

  const idNuevoGestor = idGestorExistente || uniqueId();

  const rows = personas.map((p, index) => {
	  const idInscripcion = (idGestorExistente || index > 0)
		  ? uniqueId()
		  : idNuevoGestor;

    return {
      id: idInscripcion,
      id_inscripcion_gestor: idInscripcion === idNuevoGestor && !idGestorExistente
        ? ""
        : idNuevoGestor,
      id_turno: idTurno,
      nombre: normalizarNombre(p.nombre),
      email,
      dni: normalizarDni(p.dni),
      gela: texto(p.gela),
      es_responsable: isYes(p.responsable_turno) ? 1 : 0,
      publicar_nombre: yesNo(p.publicar_nombre),
      estado: "activa"
    };
  });
	await assertShiftCapacityForRows(database, turno, rows);
	const statements = [];

  for (const row of rows) {
	  statements.push(
		  database.prepare(`
      INSERT INTO personas (
        dni,
        nombre,
        email,
        fecha_creacion,
        fecha_actualizacion
      )
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(dni) DO UPDATE SET
        nombre = CASE
          WHEN length(excluded.nombre) > length(personas.nombre)
          THEN excluded.nombre
          ELSE personas.nombre
        END,
        email = CASE
          WHEN excluded.email != ''
          THEN excluded.email
          ELSE personas.email
        END,
        fecha_actualizacion = CURRENT_TIMESTAMP
    `).bind(
      row.dni,
      row.nombre,
      row.email
    ));

	  statements.push(
		  database.prepare(`
      INSERT INTO inscripciones (
        id,
        id_inscripcion_gestor,
        id_turno,
        nombre,
        email,
        dni,
        gela,
        es_responsable,
        publicar_nombre,
        fecha_creacion,
        estado
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'activa')
    `).bind(
			  row.id,
		row.id_inscripcion_gestor || "",
		row.id_turno,
		row.nombre,
		row.email || "",
		row.dni,
		row.gela || "",
		Number(row.es_responsable || 0),
		row.publicar_nombre || "no"
		  ));
  }
	await database.batch(statements);

	await assertShiftNotOverCapacityAfterInsert(
		database,
		turno,
		rows.map(r => r.id)
	);

  const identity = {
    dni: body.gestor_dni || body.dni
  };

/*
  return {
    ok: true,
    id_inscripcion: rows[0].id,
    id_inscripcion_gestor: idNuevoGestor,
    total: rows.length,
    turnos: (await getData(env)).turnos,
    opciones: {},
    inscripciones: (await misTurnos(env, identity)).inscripciones
  };
  */
 

const turnosActualizados = (await getData(env)).turnos;
const inscripcionesActualizadas = (await misTurnos(env, identity)).inscripciones;
const opcionesActualizadas = await getOpciones(env);



const emailQueued = lanzarEmailEnSegundoPlano(env, ctx, {
  tipo: "inscripcion",
  email,
  nombre: body.gestor_nombre || body.nombre,
  rows,
  turnos: turnosActualizados,
  id_inscripcion: rows[0]?.id || ""
});

return {
  ok: true,
  id_inscripcion: rows[0].id,
  id_inscripcion_gestor: idNuevoGestor,
  total: rows.length,
  turnos: turnosActualizados,
  opciones: opcionesActualizadas,
  inscripciones: inscripcionesActualizadas,
  emailQueued
};
}

// ------------------------------------------------------------
// Cambio y baja
// ------------------------------------------------------------

async function findManagedInscription(env, body) {
  const database = db(env);

  if (!database) {
    throw appError("serverError", "No hay binding D1");
  }

  requireFields(body, ["id_inscripcion"]);

  if (!texto(body.dni)) {
    throw appError("notdata", "Falta DNI.");
  }

  const idInscripcion = texto(body.id_inscripcion);
  const dniGestion = dniSinLetra(body.dni);

	if (!isValidDniNie(body.dni)) {
		throw appError("invalidDni", "DNI/NIE no válido.");
	}
  const item = await database.prepare(`
    SELECT
      id,
      id AS id_inscripcion,
      id_inscripcion_gestor,
      id_turno,
      dni,
      nombre,
      email,
      gela,
      es_responsable,
      CASE
        WHEN COALESCE(es_responsable, 0) = 1 THEN 'si'
        ELSE 'no'
      END AS responsable_turno,
      publicar_nombre,
      estado
    FROM inscripciones
    WHERE id = ?
      AND estado = 'activa'
    LIMIT 1
  `).bind(idInscripcion).first();

  if (!item) {
    throw appError("managerNotFound", "No se ha encontrado esa inscripción activa.");
  }

  // Caso 1: la inscripción es de la propia persona.
  if (dniSinLetra(item.dni) === dniGestion) {
    return item;
  }

  // Caso 2: es una inscripción adicional gestionada por otra inscripción.
  const idGestor = texto(item.id_inscripcion_gestor);

  if (!idGestor) {
    throw appError("noPermission", "No tienes permiso para gestionar esta inscripción.");
  }

  const gestor = await database.prepare(`
    SELECT
      id,
      dni,
      estado
    FROM inscripciones
    WHERE id = ?
      AND estado = 'activa'
    LIMIT 1
  `).bind(idGestor).first();

  if (!gestor) {
    throw appError("managerNotFound", "No se ha encontrado la inscripción gestora.");
  }

  if (dniSinLetra(gestor.dni) !== dniGestion) {
    throw appError("noPermission", "No tienes permiso para gestionar esta inscripción.");
  }

  return item;
}

async function findTurnoD1(database, idTurno) {
  const turno = await database.prepare(`
    SELECT
      id,
      fecha,
      tipo,
      hora_inicio,
      hora_fin,
      plazas,
      plazas_responsable,
      activo
    FROM turnos
    WHERE id = ?
      AND activo = 1
    LIMIT 1
  `).bind(idTurno).first();

  if (!turno) {
    throw appError("shiftNotFound", "No se ha encontrado ese turno.");
  }

  return turno;
}

async function assertNotDuplicateD1(database, idTurno, dni, exceptInscriptionId = "") {
  const dniKey = dniSinLetra(dni);
	if (!isValidDniNie(dni)) {
		throw appError("invalidDni", "DNI/NIE no válido.");
	}
  if (!dniKey) return;

  const duplicate = await database.prepare(`
    SELECT id
    FROM inscripciones
    WHERE id_turno = ?
      AND estado = 'activa'
      AND id != ?
      AND ${dniSqlExpr("dni")} LIKE ?
    LIMIT 1
  `).bind(idTurno, exceptInscriptionId || "", `${dniKey}%`).first();

  if (duplicate) {
    throw appError("duplicateInTurno", "Ya está apuntada una persona con ese DNI en el turno.");
  }
}

async function cambiar(env, body, ctx) {
  const database = db(env);

  if (!database) {
    return { ok: false, errorCode: "serverError", error: "No hay binding D1" };
  }

  requireFields(body, ["id_inscripcion"]);

  const item = await findManagedInscription(env, body);
  const nuevoIdTurno = texto(
    body.id_turno_nuevo ||
    body.nuevo_id_turno ||
    item.id_turno
  );

  if (!nuevoIdTurno) {
    throw appError("missingNewShift", "Falta el turno nuevo.");
  }

  const nuevoTurno = await database.prepare(`
    SELECT
      id,
      id AS id_turno,
      fecha,
      tipo,
      hora_inicio,
      hora_fin,
      plazas,
      plazas_responsable,
      activo
    FROM turnos
    WHERE id = ?
      AND activo = 1
    LIMIT 1
  `).bind(nuevoIdTurno).first();

  if (!nuevoTurno) {
    throw appError("shiftNotFound", "No se ha encontrado el turno o no está activo.");
  }

  const cambiaTurno = item.id_turno !== nuevoIdTurno;
  const cambiaResp = Object.prototype.hasOwnProperty.call(body, "responsable_turno");

  if (!cambiaTurno && !cambiaResp) {
    throw appError("noChanges", "No hay cambios que guardar.");
  }

  const nuevoResp = cambiaResp
    ? yesNo(body.responsable_turno)
    : yesNo(item.responsable_turno);

  if (cambiaTurno) {
    await assertCapacityD1(database, nuevoIdTurno);
    await assertNotDuplicateD1(database, nuevoIdTurno, item.dni, item.id_inscripcion);
    await assertNoOverlappingShifts(
      database,
      [{ dni: item.dni, nombre: item.nombre }],
      nuevoTurno,
      item.id_inscripcion
    );
  }

  if (isYes(nuevoResp)) {
    await assertResponsibleCapacityD1(database, nuevoIdTurno, item.id_inscripcion);
  }

  await database.prepare(`
    UPDATE inscripciones
    SET
      id_turno = ?,
      es_responsable = ?
    WHERE id = ?
      AND estado = 'activa'
  `).bind(
    nuevoIdTurno,
    isYes(nuevoResp) ? 1 : 0,
    item.id_inscripcion
  ).run();

  const turnosActualizados = (await getData(env)).turnos;
  const opcionesActualizadas = await getOpciones(env);
  const inscripcionesActualizadas = (await misTurnos(env, body)).inscripciones;

  const rowEmail = {
    id: item.id_inscripcion,
    id_turno: nuevoIdTurno,
    nombre: item.nombre,
    es_responsable: isYes(nuevoResp) ? 1 : 0
  };

  const emailQueued = lanzarEmailEnSegundoPlano(env, ctx, {
    tipo: "cambio",
    email: item.email,
    nombre: item.nombre,
    rows: [rowEmail],
    turnos: turnosActualizados,
    id_inscripcion: item.id_inscripcion
  });

  return {
    ok: true,
    turnos: turnosActualizados,
    opciones: opcionesActualizadas,
    inscripciones: inscripcionesActualizadas,
    emailQueued
  };
}

async function borrar(env, body, ctx) {
  const database = db(env);

  if (!database) {
    return { ok: false, errorCode: "serverError", error: "No hay binding D1" };
  }

  const item = await findManagedInscription(env, body);
 const idTurnoBorrado = item.id_turno;
  await database.prepare(`
    UPDATE inscripciones
    SET
      estado = 'borrada',
      fecha_baja = CURRENT_TIMESTAMP
    WHERE id = ?
      AND estado = 'activa'
  `).bind(item.id_inscripcion).run();

  const turnosActualizados = (await getData(env)).turnos;
  const opcionesActualizadas = await getOpciones(env);
  const inscripcionesActualizadas = (await misTurnos(env, body)).inscripciones;

  const rowEmail = {
    id: item.id_inscripcion,
    id_turno: idTurnoBorrado,
    nombre: item.nombre,
    es_responsable: Number(item.es_responsable || 0)
  };

  const emailQueued = lanzarEmailEnSegundoPlano(env, ctx, {
    tipo: "baja",
    email: item.email,
    nombre: item.nombre,
    rows: [rowEmail],
    turnos: turnosActualizados,
    id_inscripcion: item.id_inscripcion
  }	);

  return {
    ok: true,
    turnos: turnosActualizados,
    opciones: opcionesActualizadas,
    inscripciones: inscripcionesActualizadas,
    emailQueued
  };
}

// ------------------------------------------------------------
// Cupos y solapamientos
// ------------------------------------------------------------

async function getShiftOccupancy(database, idTurno) {
	const row = await database.prepare(`
    SELECT
      SUM(CASE
        WHEN estado = 'activa' THEN 1
        ELSE 0
      END) AS ocupadas,

      SUM(CASE
        WHEN estado = 'activa'
         AND COALESCE(es_responsable, 0) = 1 THEN 1
        ELSE 0
      END) AS ocupadas_responsable
    FROM inscripciones
    WHERE id_turno = ?
  `).bind(idTurno).first();

	return {
		ocupadas: Number(row?.ocupadas || 0),
		ocupadasResponsable: Number(row?.ocupadas_responsable || 0)
	};
}

async function assertShiftCapacityForRows(database, turno, rows, excludeIds = []) {
	const idTurno = texto(turno?.id_turno || turno?.id);

	if (!idTurno) {
		throw appError("invalidShift", "Turno no válido para comprobar cupo.");
	}

	const plazas = Number(turno.plazas || 0);
	const plazasResponsable = Number(turno.plazas_responsable || 0);

	const occupancy = await getShiftOccupancy(database, idTurno);

	const excludeSet = new Set(excludeIds.filter(Boolean).map(String));

	let nuevasPersonas = 0;
	let nuevosResponsables = 0;

	for (const row of rows) {
		if (excludeSet.has(String(row.id))) continue;

		nuevasPersonas += 1;
		if (Number(row.es_responsable || 0) === 1) {
			nuevosResponsables += 1;
		}
	}

	if (occupancy.ocupadas + nuevasPersonas > plazas) {
		throw appError("noCapacity", "No quedan plazas suficientes en este turno.");
	}

	if (occupancy.ocupadasResponsable + nuevosResponsables > plazasResponsable) {
		throw appError("noResponsibleCapacity", "No quedan plazas de responsable en este turno.");
	}
}

async function assertShiftNotOverCapacityAfterInsert(database, turno, insertedIds = []) {
	const idTurno = texto(turno?.id_turno || turno?.id);

	if (!idTurno) {
		throw appError("invalidShift", "Turno no válido para comprobar cupo.");
	}

	const plazas = Number(turno.plazas || 0);
	const plazasResponsable = Number(turno.plazas_responsable || 0);

	const occupancy = await getShiftOccupancy(database, idTurno);

	const overCapacity = occupancy.ocupadas > plazas;
	const overResponsibleCapacity = occupancy.ocupadasResponsable > plazasResponsable;

	if (!overCapacity && !overResponsibleCapacity) {
		return;
	}

	// Revertimos solo las filas creadas en esta petición.
	if (insertedIds.length) {
		const placeholders = insertedIds.map(() => "?").join(",");

		await database.prepare(`
      UPDATE inscripciones
      SET estado = 'anulada'
      WHERE id IN (${placeholders})
    `).bind(...insertedIds).run();
	}

	if (overResponsibleCapacity) {
		throw appError("noResponsibleCapacity", "No quedan plazas de responsable en este turno.");
	}

	throw appError("noCapacity", "No quedan plazas suficientes en este turno.");
}

async function countInTurnoD1(database, idTurno) {
  const row = await database.prepare(`
    SELECT COUNT(*) AS total
    FROM inscripciones
    WHERE id_turno = ?
      AND estado = 'activa'
  `).bind(idTurno).first();

  return Number(row?.total || 0);
}

async function countResponsablesInTurnoD1(database, idTurno, exceptInscriptionId = "") {
  const row = await database.prepare(`
    SELECT COUNT(*) AS total
    FROM inscripciones
    WHERE id_turno = ?
      AND estado = 'activa'
      AND COALESCE(es_responsable, 0) = 1
      AND id != ?
  `).bind(idTurno, exceptInscriptionId || "").first();

  return Number(row?.total || 0);
}

async function assertCapacityD1(database, idTurno) {
  const turno = await findTurnoD1(database, idTurno);
  const ocupadas = await countInTurnoD1(database, idTurno);

  if (ocupadas >= Number(turno.plazas || 0)) {
    throw appError("shiftFull", "Ese turno está completo.");
  }
}

async function assertResponsibleCapacityD1(database, idTurno, exceptInscriptionId = "") {
  const turno = await findTurnoD1(database, idTurno);
  const plazasResponsable = Number(turno.plazas_responsable || 0);

  if (plazasResponsable <= 0) {
    throw appError("notResp", "Este turno no tiene plazas de responsable disponibles.");
  }

  const responsablesActuales = await countResponsablesInTurnoD1(
    database,
    idTurno,
    exceptInscriptionId || ""
  );

  if (responsablesActuales >= plazasResponsable) {
    throw appError("notEnoughResp", "Ya están cubiertas las plazas de responsable de este turno.");
  }
}

function timeToMinutes(value) {
	const raw = String(value || "").trim();

	const match = raw.match(/^(\d{1,2}):(\d{2})$/);
	if (!match) return null;

	const hours = Number(match[1]);
	const minutes = Number(match[2]);

	if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

	return hours * 60 + minutes;
}

function shiftsOverlap(aStart, aEnd, bStart, bEnd) {
	let a1 = timeToMinutes(aStart);
	let a2 = timeToMinutes(aEnd);
	let b1 = timeToMinutes(bStart);
	let b2 = timeToMinutes(bEnd);

	if (a1 === null || a2 === null || b1 === null || b2 === null) {
		return false;
	}

	// Turnos que cruzan medianoche, ej. 17:30-01:30
	if (a2 <= a1) a2 += 24 * 60;
	if (b2 <= b1) b2 += 24 * 60;

	return a1 < b2 && b1 < a2;
}

async function assertNoOverlappingShifts(database, personas, turno, excludeInscriptionId = "") {
  const idTurno = texto(turno?.id_turno || turno?.id);
  const fecha = fechaParaCliente(turno?.fecha);
  const horaInicio = texto(turno?.hora_inicio);
  const horaFin = texto(turno?.hora_fin);

  if (!idTurno || !fecha || !horaInicio || !horaFin) {
    throw appError(
      "invalidShiftForOverlap",
      "No se puede comprobar solapamiento porque faltan datos del turno."
    );
  }

  const dniKeys = personas
    .map(p => dniSinLetra(p.dni))
    .filter(Boolean);

  if (!dniKeys.length) return;

  const placeholders = dniKeys.map(() => "?").join(",");
  const excludeSql = excludeInscriptionId ? "AND i.id != ?" : "";

  const rows = await database.prepare(`
    SELECT
      i.id,
      i.dni,
      i.nombre,
      t.id AS id_turno,
      t.fecha,
      t.tipo,
      t.hora_inicio,
      t.hora_fin
    FROM inscripciones i
    JOIN turnos t
      ON t.id = i.id_turno
    WHERE i.estado = 'activa'
      AND t.activo = 1
      AND t.fecha = ?
      AND i.id_turno != ?
      ${excludeSql}
      AND substr(
        ${dniSqlExpr("i.dni")},
        1,
        length(${dniSqlExpr("i.dni")}) - 1
      ) IN (${placeholders})
  `).bind(
    fecha,
    idTurno,
    ...(excludeInscriptionId ? [String(excludeInscriptionId)] : []),
    ...dniKeys
  ).all();

  for (const row of rows.results || []) {
    if (shiftsOverlap(horaInicio, horaFin, row.hora_inicio, row.hora_fin)) {
      throw appError(
        "overlappingShift",
        `La persona ${row.nombre || ""} ya está apuntada a otro turno que se solapa: ${row.tipo} ${row.hora_inicio}-${row.hora_fin}.`
      );
    }
  }
}

// ------------------------------------------------------------
// Administración
// ------------------------------------------------------------

function adminPassword(env) {
	const pwd = String(env.ADMIN_PASSWORD || "").trim();

	if (!pwd) {
		throw appError("adminPasswordNotConfigured", "ADMIN_PASSWORD no está configurada.");
	}

	return pwd;
}

function requireAdminPassword(env, pwd) {
	const expected = adminPassword(env);
	const received = String(pwd || "");

	if (!received || received !== expected) {
		throw appError("adminUnauthorized", "Contraseña incorrecta.");
	}
}

async function getAdminData(env, pwd) {
  requireAdminPassword(env, pwd);

  return {
    ok: true,
    turnos: await getAdminTurnos(env),
    opciones: await getOpciones(env)
  };
}

async function getAdminTurnos(env) {
  const database = db(env);

  if (!database) {
    throw appError("serverError", "No hay binding D1");
  }

  const turnosResult = await database.prepare(`
    SELECT
      t.id,
      t.id AS id_turno,
      t.fecha,
      t.tipo,
      t.hora_inicio,
      t.hora_fin,
      t.plazas,
      t.plazas_responsable,
      t.activo
    FROM turnos t
    WHERE t.activo = 1
    ORDER BY t.fecha, t.hora_inicio, t.tipo
  `).all();

  const inscritosResult = await database.prepare(`
    SELECT
      i.id,
      i.id AS id_inscripcion,
      i.id_inscripcion_gestor,
      i.id_turno,
      i.nombre,
      i.email,
      i.dni,
      i.gela,
      i.es_responsable,
      CASE
        WHEN COALESCE(i.es_responsable, 0) = 1 THEN 'si'
        ELSE 'no'
      END AS responsable_turno,
      i.publicar_nombre,
      i.fecha_creacion
    FROM inscripciones i
    WHERE i.estado = 'activa'
    ORDER BY i.fecha_creacion ASC
  `).all();

  const inscritosPorTurno = {};

  for (const row of inscritosResult.results || []) {
    const idTurno = row.id_turno;
    if (!inscritosPorTurno[idTurno]) inscritosPorTurno[idTurno] = [];

    inscritosPorTurno[idTurno].push({
      id_inscripcion: row.id_inscripcion || row.id,
      id_inscripcion_gestor: row.id_inscripcion_gestor || "",
      nombre: String(row.nombre || "").trim(),
      email: String(row.email || "").trim(),
      dni: String(row.dni || "").trim(),
      gela: String(row.gela || "").trim(),
      responsable_turno: row.responsable_turno || (Number(row.es_responsable) ? "si" : "no"),
      publicar_nombre: yesNo(row.publicar_nombre)
    });
  }

  return (turnosResult.results || []).map(row => {
    const turno = turnoParaCliente(row);
    const inscritos = inscritosPorTurno[turno.id_turno] || [];

    const plazas = Number(turno.plazas || 0);
    const plazasResponsable = Number(turno.plazas_responsable || 0);
    const plazasOcupadas = inscritos.length;
    const responsablesOcupadas = inscritos.filter(p => yesNo(p.responsable_turno) === "si").length;

    return {
      ...turno,
      inscritos,
      plazas_ocupadas: plazasOcupadas,
      plazas_disponibles: Math.max(plazas - plazasOcupadas, 0),
      plazas_responsable_ocupadas: responsablesOcupadas,
      plazas_responsable_disponibles: Math.max(plazasResponsable - responsablesOcupadas, 0),
      permite_responsable_turno: responsablesOcupadas < plazasResponsable
    };
  });
}

async function getEmailLogs(env, pwd, limit = 100) {
requireAdminPassword(env, pwd);


  const database = db(env);
  if (!database) {
    return {
      ok: false,
      errorCode: "serverError",
      error: "No hay binding D1"
    };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 300);

  const result = await database.prepare(`
    SELECT
      id,
      tipo,
      email,
      nombre,
      id_inscripcion,
      estado,
      error,
      fecha_creacion
    FROM email_logs
    ORDER BY fecha_creacion DESC
    LIMIT ${safeLimit}
  `).all();

  return {
    ok: true,
    logs: result.results || []
  };
}

async function reenviarEmail(env, body, ctx) {
  requireAdminPassword(env, body?.pwd);

  const database = db(env);
  if (!database) {
    return {
      ok: false,
      errorCode: "serverError",
      error: "No hay binding D1"
    };
  }

  const idInscripcion = texto(body?.id_inscripcion);
  const tipo = texto(body?.tipo || "inscripcion");

  if (!idInscripcion) {
    return {
      ok: false,
      errorCode: "missingInscriptionId",
      error: "Falta id_inscripcion."
    };
  }

  const item = await database.prepare(`
    SELECT
      id,
      id AS id_inscripcion,
      id_turno,
      nombre,
      email,
      dni,
      gela,
      es_responsable,
      estado
    FROM inscripciones
    WHERE id = ?
    LIMIT 1
  `).bind(idInscripcion).first();

  if (!item) {
    return {
      ok: false,
      errorCode: "inscriptionNotFound",
      error: "No se ha encontrado la inscripción."
    };
  }

  if (!item.email) {
    return {
      ok: false,
      errorCode: "inscriptionMissingEmail",
      error: "La inscripción no tiene email."
    };
  }

  const turno = await database.prepare(`
    SELECT
      id,
      id AS id_turno,
      fecha,
      tipo,
      hora_inicio,
      hora_fin,
      plazas,
      plazas_responsable,
      activo
    FROM turnos
    WHERE id = ?
    LIMIT 1
  `).bind(item.id_turno).first();

  if (!turno) {
    return {
      ok: false,
      errorCode: "associatedShiftNotFound",
      error: "No se ha encontrado el turno asociado."
    };
  }

  const rowEmail = {
    id: item.id_inscripcion,
    id_turno: item.id_turno,
    nombre: item.nombre,
    es_responsable: Number(item.es_responsable || 0)
  };

  const emailQueued = lanzarEmailEnSegundoPlano(env, ctx, {
    tipo,
    email: item.email,
    nombre: item.nombre,
    rows: [rowEmail],
    turnos: [turnoParaCliente(turno)],
    id_inscripcion: item.id_inscripcion
  });

  return {
    ok: true,
    emailQueued
  };
}

// ------------------------------------------------------------
// Email
// ------------------------------------------------------------

function escapeHtmlEmail(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

async function enviarEmailConfirmacionGmail(env, {
	tipo = "inscripcion",
	email,
	nombre,
	rows,
	turnos
}) {
	if (!email) {
		return {
			sent: false,
			reason: "missing_email"
		};
	}

	if (!env.MAIL_SCRIPT_URL) {
		return {
			sent: false,
			reason: "missing_mail_script_url"
		};
	}

	if (!env.MAIL_SCRIPT_SECRET) {
		return {
			sent: false,
			reason: "missing_mail_script_secret"
		};
	}

	const turnosEmail = rows.map(row => {
		const turno = turnos.find(t =>
			String(t.id_turno || t.id) === String(row.id_turno)
		);

		return {
			nombre: row.nombre,
			fecha: turno?.fecha || "",
			tipo: turno?.tipo || "",
			hora_inicio: turno?.hora_inicio || "",
			hora_fin: turno?.hora_fin || "",
			responsable: Number(row.es_responsable || 0) === 1
		};
	});

	const response = await fetch(env.MAIL_SCRIPT_URL, {
		method: "POST",
		headers: {
			"Content-Type": "text/plain;charset=utf-8"
		},
		body: JSON.stringify({
			secret: env.MAIL_SCRIPT_SECRET,
			to: email,
			tipo,
			nombre,
			turnos: turnosEmail
		})
	});

	const data = await response.json().catch(() => ({}));

	if (!response.ok || !data.ok) {
		return {
			sent: false,
			status: response.status,
			error: data
		};
	}

	return {
		sent: true,
		result: data
	};
}

async function logEmail(env, {
	tipo,
	email,
	nombre = "",
	id_inscripcion = "",
	estado,
	error = ""
}) {
	const database = db(env);
	if (!database) return;

	try {
		await database.prepare(`
      INSERT INTO email_logs (
        id,
        tipo,
        email,
        nombre,
        id_inscripcion,
        estado,
        error,
        fecha_creacion
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
			crypto.randomUUID(),
			String(tipo || ""),
			String(email || ""),
			String(nombre || ""),
			String(id_inscripcion || ""),
			String(estado || ""),
			String(error || "")
		).run();
	} catch (err) {
		console.error("Error guardando email_logs:", err);
	}
}

function lanzarEmailEnSegundoPlano(env, ctx, {
	tipo,
	email,
	nombre,
	rows,
	turnos,
	id_inscripcion = ""
}) {
	if (!email) {
		if (ctx && typeof ctx.waitUntil === "function") {
			ctx.waitUntil(logEmail(env, {
				tipo,
				email,
				nombre,
				id_inscripcion,
				estado: "skipped",
				error: "missing_email"
			}));
		}

		return false;
	}

	if (!ctx || typeof ctx.waitUntil !== "function") {
		return false;
	}

	ctx.waitUntil((async () => {
		await logEmail(env, {
			tipo,
			email,
			nombre,
			id_inscripcion,
			estado: "queued"
		});

		try {
			const result = await enviarEmailConfirmacionGmail(env, {
				tipo,
				email,
				nombre,
				rows,
				turnos
			});

			await logEmail(env, {
				tipo,
				email,
				nombre,
				id_inscripcion,
				estado: result?.sent ? "sent" : "error",
				error: result?.sent ? "" : JSON.stringify(result || {})
			});

		} catch (err) {
			await logEmail(env, {
				tipo,
				email,
				nombre,
				id_inscripcion,
				estado: "error",
				error: err.message || String(err)
			});
		}
	})());

	return true;
}
