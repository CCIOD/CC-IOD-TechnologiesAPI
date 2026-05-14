/**
 * Smoke tests para los endpoints de FASE 0 + FASE 1.
 *
 * Uso:
 *   npm run smoke
 *
 * Variables de entorno requeridas (en .env del backend):
 *   SMOKE_BASE_URL        Default: http://localhost:5000
 *   SMOKE_ADMIN_EMAIL     Email de un usuario role_id = 1 (Admin) ya existente
 *   SMOKE_ADMIN_PASSWORD  Contraseña de ese admin
 *
 * Lo que prueba:
 *   1. /health
 *   2. /api/info
 *   3. POST /auth/login (Admin) → JWT
 *   4. PIN: PUT /auth/pin → POST /auth/login-pin → DELETE /auth/pin
 *   5. IP whitelist CRUD
 *   6. Dispositivos autorizados CRUD
 *   7. /access-control/attempts (debe tener al menos una entrada de éxito)
 *   8. WebAuthn options (login-options para un email sin credenciales → 404)
 *
 * No prueba el flujo completo de WebAuthn porque requiere un autenticador real
 * (huella / llave). Eso queda para QA manual desde el frontend.
 */
import 'dotenv/config';

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:5000';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;

const TEST_PIN = '142857';
const TEST_CIDR = '203.0.113.0/24'; // RFC 5737 — bloque reservado para docs
const TEST_DEVICE_TOKEN = `smoke-${Date.now()}`;

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const ok = (label: string, detail?: string) => {
  passed++;
  console.log(`${GREEN}✓${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
};

const fail = (label: string, detail?: string) => {
  failed++;
  console.log(`${RED}✗${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
};

const warn = (label: string) => {
  console.log(`${YELLOW}!${RESET} ${label}`);
};

interface ApiResult<T = any> {
  status: number;
  body: T;
}

const call = async <T = any>(
  method: string,
  path: string,
  opts: { token?: string; body?: any; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  // Para POST/PUT/PATCH siempre enviamos al menos `{}` para que body-parsers
  // estrictos que validan JSON.parse no exploten con body vacío.
  const needsBody = ['POST', 'PUT', 'PATCH'].includes(method);
  const payload = opts.body !== undefined ? opts.body : needsBody ? {} : undefined;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

const expect = (cond: boolean, label: string, detail?: string) => {
  if (cond) ok(label, detail);
  else fail(label, detail);
  return cond;
};

/**
 * Imprime el body si el status indica error de servidor o validación que valga la pena diagnosticar.
 */
const dumpIfError = (label: string, result: ApiResult) => {
  if (result.status >= 500 || (result.status === 400 && result.body)) {
    console.log(`${DIM}  ↳ ${label} body:${RESET} ${JSON.stringify(result.body)?.slice(0, 400)}`);
  }
};

const section = (title: string) => {
  console.log(`\n${DIM}── ${title} ──${RESET}`);
};

async function main() {
  console.log(`${DIM}Backend:${RESET} ${BASE}`);

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error(
      `${RED}Faltan SMOKE_ADMIN_EMAIL y/o SMOKE_ADMIN_PASSWORD en .env.${RESET}`,
    );
    process.exit(2);
  }

  // 1. Health
  section('Health');
  {
    const r = await call('GET', '/health');
    expect(r.status === 200, '/health responde 200', `status=${r.status}`);
  }

  // 2. API info
  section('API info');
  {
    const r = await call('GET', '/api/info');
    expect(
      r.status === 200 && Array.isArray(r.body?.endpoints),
      '/api/info responde 200 con endpoints',
    );
    expect(
      r.body?.endpoints?.includes('/access-control'),
      '/api/info lista /access-control',
    );
  }

  // 3. Login Admin
  section('Login Admin');
  const login = await call<{ token: string; data: any; message?: string }>(
    'POST',
    '/auth/login',
    { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } },
  );
  expect(login.status === 201, 'POST /auth/login → 201', `status=${login.status}`);
  const token = login.body?.token;
  if (!token) {
    fail('No se recibió token del login. Aborto.');
    console.log(`${DIM}Server respondió:${RESET} ${JSON.stringify(login.body, null, 2)}`);
    console.log(
      `${YELLOW}Pista:${RESET} el endpoint /auth/login exige una contraseña que cumpla el regex de\n` +
        `${DIM}  src/helpers/JOIValidations.ts:131${RESET} — mínimo 8 chars, mayúscula, minúscula,\n` +
        `dígito, carácter especial y sin espacios. Si tu admin tiene una contraseña que no\n` +
        `cumple ese formato, el login falla con 400 antes de tocar la DB.\n` +
        `Confirma SMOKE_ADMIN_EMAIL y SMOKE_ADMIN_PASSWORD en .env.`,
    );
    process.exit(1);
  }
  ok('Token JWT recibido', `${token.slice(0, 20)}…`);

  // 4. PIN flow
  section('PIN (Login Rápido)');
  {
    const setRes = await call('PUT', '/auth/pin', { token, body: { pin: TEST_PIN } });
    expect(setRes.status === 200, 'PUT /auth/pin → 200', `status=${setRes.status}`);

    const pinLogin = await call<{ token: string }>('POST', '/auth/login-pin', {
      body: { email: ADMIN_EMAIL, pin: TEST_PIN },
    });
    expect(
      pinLogin.status === 201 && !!pinLogin.body?.token,
      'POST /auth/login-pin con PIN correcto → 201 + token',
      `status=${pinLogin.status}`,
    );

    const badPin = await call('POST', '/auth/login-pin', {
      body: { email: ADMIN_EMAIL, pin: '000000' },
    });
    expect(
      badPin.status === 401,
      'POST /auth/login-pin con PIN incorrecto → 401',
      `status=${badPin.status}`,
    );

    const del = await call('DELETE', '/auth/pin', { token });
    expect(del.status === 200, 'DELETE /auth/pin (cleanup) → 200', `status=${del.status}`);
  }

  // 5. IP whitelist CRUD
  section('IP whitelist');
  let ipId: number | undefined;
  {
    const create = await call('POST', '/access-control/ip-whitelist', {
      token,
      body: { cidr: TEST_CIDR, label: 'Smoke test entry', is_active: true },
    });
    expect(create.status === 201, 'POST /access-control/ip-whitelist → 201', `status=${create.status}`);
    ipId = create.body?.data?.ip_whitelist_id;
    expect(typeof ipId === 'number', 'Respuesta incluye ip_whitelist_id');

    const list = await call('GET', '/access-control/ip-whitelist', { token });
    expect(
      list.status === 200 && Array.isArray(list.body?.data),
      'GET /access-control/ip-whitelist → 200 con array',
    );
    expect(
      list.body?.data?.some((r: any) => r.ip_whitelist_id === ipId),
      'La entrada creada aparece en el listado',
    );

    if (ipId) {
      const upd = await call('PUT', `/access-control/ip-whitelist/${ipId}`, {
        token,
        body: { label: 'Smoke test entry (updated)' },
      });
      expect(upd.status === 200, 'PUT /access-control/ip-whitelist/:id → 200');

      const del = await call('DELETE', `/access-control/ip-whitelist/${ipId}`, { token });
      expect(del.status === 200, 'DELETE /access-control/ip-whitelist/:id → 200');
    }
  }

  // 6. Dispositivos
  section('Dispositivos autorizados');
  let deviceId: number | undefined;
  {
    const create = await call('POST', '/access-control/devices', {
      token,
      body: { device_token: TEST_DEVICE_TOKEN, label: 'Smoke test device' },
    });
    expect(create.status === 201, 'POST /access-control/devices → 201', `status=${create.status}`);
    deviceId = create.body?.data?.device_id;

    const list = await call('GET', '/access-control/devices', { token });
    expect(
      list.status === 200 && list.body?.data?.some((r: any) => r.device_id === deviceId),
      'El dispositivo creado aparece en el listado',
    );

    if (deviceId) {
      const del = await call('DELETE', `/access-control/devices/${deviceId}`, { token });
      expect(del.status === 200, 'DELETE /access-control/devices/:id → 200');
    }
  }

  // 7. Bitácora de intentos
  section('Bitácora de intentos de acceso');
  {
    const r = await call('GET', '/access-control/attempts?limit=10', { token });
    expect(r.status === 200, 'GET /access-control/attempts → 200');
    expect(Array.isArray(r.body?.data), 'data es array');
    expect(
      typeof r.body?.total === 'number' && r.body.total > 0,
      'Hay intentos registrados (el login de este test ya generó al menos uno)',
      `total=${r.body?.total}`,
    );
    const hasSuccess = r.body?.data?.some(
      (row: any) => row.outcome === 'success' && row.email === ADMIN_EMAIL.toLowerCase(),
    );
    expect(hasSuccess, 'Existe un intento outcome=success para el admin de prueba');
  }

  // 8. WebAuthn options para email sin credenciales
  section('WebAuthn');
  {
    const r = await call('POST', '/auth/webauthn/login-options', {
      body: { email: ADMIN_EMAIL },
    });
    // Si el admin no tiene credenciales WebAuthn registradas (esperado en smoke),
    // el server devuelve 404. Si las tiene, devuelve 200 con opciones.
    if (r.status === 404) {
      ok('POST /auth/webauthn/login-options → 404 (no hay credenciales para el admin)');
    } else if (r.status === 200) {
      ok('POST /auth/webauthn/login-options → 200 (el admin sí tiene credenciales)');
    } else {
      fail('POST /auth/webauthn/login-options', `status inesperado=${r.status}`);
    }

    const r2 = await call('POST', '/auth/webauthn/register-options', { token });
    const passed2 = r2.status === 200 && !!r2.body?.data?.challenge;
    expect(
      passed2,
      'POST /auth/webauthn/register-options (auth) → 200 + challenge',
      `status=${r2.status}`,
    );
    if (!passed2) {
      console.log(
        `${DIM}Server respondió:${RESET} ${JSON.stringify(r2.body, null, 2)}`,
      );
    }
  }

  // 9. Alert protocols (plantillas)
  section('Plantillas de alerta');
  {
    const list = await call('GET', '/alert-protocols', { token });
    expect(list.status === 200, 'GET /alert-protocols → 200', `status=${list.status}`);
    dumpIfError('GET /alert-protocols', list);
    expect(
      Array.isArray(list.body?.data) && list.body.data.length >= 5,
      'Listado incluye al menos las 5 plantillas seed',
      `count=${list.body?.data?.length}`,
    );
    expect(
      Array.isArray(list.body?.available_variables),
      'Listado expone available_variables para el frontend',
    );
  }

  // 10. Crear alerta → mensaje generado → editar → desactivar
  section('Alertas (crear / editar / desactivar)');
  let alertId: number | undefined;
  {
    const created = await call('POST', '/alerts', {
      token,
      body: {
        alert_type: 'zona_exclusion',
        zona_exclusion: 'Smoke test zone',
        correa: 'OK',
        info_operativa: 'Generada por smoke test',
      },
    });
    expect(created.status === 201, 'POST /alerts → 201', `status=${created.status}`);
    dumpIfError('POST /alerts', created);
    alertId = created.body?.data?.alert_id;
    expect(typeof alertId === 'number', 'Respuesta incluye alert_id');
    expect(
      typeof created.body?.data?.generated_message === 'string' &&
        created.body.data.generated_message.includes('Smoke test zone'),
      'generated_message renderizó la plantilla con la zona',
      created.body?.data?.generated_message?.slice(0, 80),
    );
    expect(
      created.body?.data?.activated_by != null && created.body?.data?.activated_at != null,
      'activated_at y activated_by los setea el server',
    );

    // Intentar mandar description manual → debe ser rechazado
    const denied = await call('POST', '/alerts', {
      token,
      body: { alert_type: 'zona_exclusion', description: 'no debería pasar' },
    });
    expect(denied.status === 400, 'POST /alerts con description manual → 400');

    if (alertId) {
      const edit = await call('PUT', `/alerts/${alertId}`, {
        token,
        body: { info_operativa: 'Editado pre-reporte' },
      });
      expect(edit.status === 200, 'PUT /alerts/:id (edición pre-reporte) → 200');
      expect(
        edit.body?.data?.info_operativa === 'Editado pre-reporte',
        'Cambio aplicado',
      );

      // Intento setear un campo prohibido → 400
      const forbidden = await call('PUT', `/alerts/${alertId}`, {
        token,
        body: { generated_message: 'hackeado' },
      });
      expect(forbidden.status === 400, 'PUT /alerts/:id con campo prohibido → 400');

      const deactivate = await call('PUT', `/alerts/${alertId}/deactivate`, { token });
      expect(
        deactivate.status === 200 && deactivate.body?.data?.status === 'desactivada',
        'PUT /alerts/:id/deactivate → 200 + status="desactivada"',
      );

      // Re-desactivar → 409
      const dup = await call('PUT', `/alerts/${alertId}/deactivate`, { token });
      expect(dup.status === 409, 'Desactivar una alerta ya desactivada → 409');
    }
  }

  // 11. Reportar a autoridad → bloqueo
  section('Reporte a autoridad (bloqueo post-reporte)');
  let reportedAlertId: number | undefined;
  {
    const created = await call('POST', '/alerts', {
      token,
      body: {
        alert_type: 'manipulacion_correa',
        correa: 'manipulada',
        info_operativa: 'Para test de reporte',
      },
    });
    reportedAlertId = created.body?.data?.alert_id;
    if (!reportedAlertId) {
      fail('No se pudo crear alerta para test de reporte');
    } else {
      const reportRes = await call('POST', `/alerts/${reportedAlertId}/report`, { token });
      expect(
        reportRes.status === 200 && reportRes.body?.data?.locked === true,
        'POST /alerts/:id/report → 200 + locked=true',
      );

      const editAfter = await call('PUT', `/alerts/${reportedAlertId}`, {
        token,
        body: { info_operativa: 'No debería poder cambiar' },
      });
      expect(editAfter.status === 409, 'PUT /alerts/:id post-reporte → 409 (bloqueada)');

      const deactivateAfter = await call('PUT', `/alerts/${reportedAlertId}/deactivate`, { token });
      expect(deactivateAfter.status === 409, 'Desactivar alerta bloqueada → 409');

      const reReport = await call('POST', `/alerts/${reportedAlertId}/report`, { token });
      expect(reReport.status === 409, 'Re-reportar alerta ya reportada → 409');
    }
  }

  // 12. Bitácora
  section('Bitácora de alertas');
  {
    const audit = await call('GET', '/alerts/audit?limit=20', { token });
    expect(audit.status === 200, 'GET /alerts/audit → 200', `status=${audit.status}`);
    expect(
      Array.isArray(audit.body?.data) && audit.body.data.length > 0,
      'Bitácora tiene entradas (al menos CREATE y REPORT de este test)',
      `total=${audit.body?.total}`,
    );
    if (reportedAlertId) {
      const reportEntry = audit.body?.data?.find(
        (e: any) => e.alert_id === reportedAlertId && e.action_type === 'REPORT',
      );
      expect(!!reportEntry, 'Existe la entrada REPORT de la alerta reportada');
    }
  }

  // 13. Detalle con audit embebido
  section('Detalle de alerta');
  if (reportedAlertId) {
    const detail = await call('GET', `/alerts/${reportedAlertId}`, { token });
    expect(detail.status === 200, 'GET /alerts/:id → 200');
    expect(detail.body?.data?.is_locked === true, 'is_locked = true');
    expect(
      Array.isArray(detail.body?.data?.audit_log) && detail.body.data.audit_log.length >= 2,
      'audit_log embebido tiene CREATE + REPORT',
    );
  }

  // 14. Reportes semanales (formato oficial — requiere un carrier en DB)
  section('Reportes semanales (formato oficial)');
  let weeklyReportId: number | undefined;
  {
    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Busca un carrier existente para el smoke (no creamos uno; usamos el primero
    // que devuelva /carriers para no contaminar datos)
    const carriersRes = await call<{ data: any[] }>('GET', '/carriers', { token });
    const carrier = carriersRes.body?.data?.[0];
    if (!carrier) {
      warn(
        'Smoke de Reportes Semanales omitido: no hay portadores registrados. ' +
          'Crea al menos uno desde /panel/portadores y vuelve a correr el smoke.',
      );
    } else {
      // Validación: faltando carrier_id → 400
      const bad = await call('POST', '/weekly-reports/generate', {
        token,
        body: { period_from: yesterday, period_to: todayStr },
      });
      expect(
        bad.status === 400,
        'POST /weekly-reports/generate sin carrier_id → 400',
      );

      const gen = await call('POST', '/weekly-reports/generate', {
        token,
        body: {
          carrier_id: carrier.id,
          period_from: yesterday,
          period_to: todayStr,
          summary: 'Generado por el smoke test',
        },
      });
      expect(gen.status === 201, 'POST /weekly-reports/generate → 201', `status=${gen.status}`);
      dumpIfError('POST /weekly-reports/generate', gen);
      weeklyReportId = gen.body?.data?.weekly_report_id;
      expect(typeof weeklyReportId === 'number', 'Respuesta incluye weekly_report_id');
      expect(
        typeof gen.body?.data?.folio === 'string' &&
          gen.body.data.folio.startsWith('OFICIO/DO/'),
        'Folio generado con patrón OFICIO/DO/…',
        gen.body?.data?.folio,
      );
      expect(
        typeof gen.body?.data?.report_document === 'string' &&
          gen.body.data.report_document.includes('weekly-reports'),
        'report_document apunta al container weekly-reports',
      );

      const list = await call('GET', '/weekly-reports?limit=5', { token });
      expect(list.status === 200, 'GET /weekly-reports → 200');
      expect(
        Array.isArray(list.body?.data) &&
          list.body.data.some((r: any) => r.weekly_report_id === weeklyReportId),
        'El reporte recién creado aparece en el listado',
      );

      if (weeklyReportId) {
        // Subir una imagen pequeña como attachment
        const pngBase64 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        const buf = Buffer.from(pngBase64, 'base64');
        const fd = new FormData();
        const blob = new Blob([buf], { type: 'image/png' });
        fd.append('images', blob, 'smoke-pixel.png');
        fd.append('section', 'evidencia');
        fd.append('caption', 'Pixel de smoke test');
        const up = await fetch(`${BASE}/weekly-reports/${weeklyReportId}/attachments`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const upBody = await up.json().catch(() => null);
        expect(up.status === 201, 'POST attachments → 201', `status=${up.status}`);
        if (up.status !== 201) {
          console.log(`${DIM}  ↳ body:${RESET} ${JSON.stringify(upBody)?.slice(0, 200)}`);
        }
        const attachmentId = upBody?.data?.[0]?.attachment_id;

        const regen = await call('POST', `/weekly-reports/${weeklyReportId}/regenerate`, { token });
        expect(regen.status === 200, 'POST /weekly-reports/:id/regenerate → 200');

        const detail = await call('GET', `/weekly-reports/${weeklyReportId}`, { token });
        expect(detail.status === 200, 'GET /weekly-reports/:id → 200');
        expect(
          Array.isArray(detail.body?.data?.attachments) &&
            detail.body.data.attachments.length > 0,
          'Detalle incluye attachments',
        );

        if (attachmentId) {
          const delAtt = await call(
            'DELETE',
            `/weekly-reports/${weeklyReportId}/attachments/${attachmentId}`,
            { token },
          );
          expect(delAtt.status === 200, 'DELETE attachment → 200');
        }

        const del = await call('DELETE', `/weekly-reports/${weeklyReportId}`, { token });
        expect(del.status === 200, 'DELETE /weekly-reports/:id (cleanup) → 200');
      }
    }
  }

  // 15. Auditoría consolidada (FASE 5)
  section('Auditoría consolidada');
  {
    const unified = await call('GET', '/audit/unified?limit=50', { token });
    expect(unified.status === 200, 'GET /audit/unified → 200', `status=${unified.status}`);
    dumpIfError('GET /audit/unified', unified);
    expect(Array.isArray(unified.body?.data), 'Unified data es array');
    expect(
      typeof unified.body?.total === 'number' && unified.body.total > 0,
      'Unified tiene entradas',
      `total=${unified.body?.total}`,
    );
    const sources = new Set(unified.body?.data?.map((r: any) => r.source));
    expect(
      sources.has('alerts') && sources.has('access'),
      'Unified incluye alertas Y accesos en el feed',
      `sources=${[...sources].join(',')}`,
    );

    // Filtro por source único
    const onlyAccess = await call('GET', '/audit/unified?source=access&limit=10', { token });
    expect(onlyAccess.status === 200, 'Filtro ?source=access → 200');
    expect(
      onlyAccess.body?.data?.every((r: any) => r.source === 'access'),
      'Todas las filas son source=access cuando se filtra',
    );

    const summary = await call('GET', '/audit/summary', { token });
    expect(summary.status === 200, 'GET /audit/summary → 200');
    expect(
      summary.body?.data?.totals &&
        typeof summary.body.data.totals.alerts === 'number' &&
        typeof summary.body.data.totals.access === 'number',
      'Summary devuelve totals con alerts y access',
    );
    expect(
      Array.isArray(summary.body?.data?.top_users) &&
        Array.isArray(summary.body?.data?.per_day),
      'Summary devuelve top_users y per_day',
    );
  }

  // Resumen
  console.log(`\n${DIM}──────────${RESET}`);
  if (failed === 0) {
    console.log(`${GREEN}✓ Todos los smoke tests pasaron${RESET} (${passed})`);
    process.exit(0);
  } else {
    console.log(`${RED}✗ Fallaron ${failed}${RESET}  ${GREEN}✓ pasaron ${passed}${RESET}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${RED}Error fatal en smoke test:${RESET}`, err);
  process.exit(1);
});
