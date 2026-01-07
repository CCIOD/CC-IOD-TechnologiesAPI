import { Request, Response, NextFunction } from 'express';
import { pool } from '../database/connection';

/**
 * ENUM client_status valores válidos:
 * - 'Pendiente de colocación'
 * - 'Colocado'
 * - 'Desinstalado'
 * - 'Cancelado'
 * - 'Pendiente de audiencia'
 * - 'Pendiente de aprobación'
 *
 * NOTA: "Clientes activos" se considera 'Pendiente de colocación' + 'Colocado'
 */

/**
 * Obtener resumen para el dashboard de administración
 */
export const getDashboardSummary = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  try {
    // 1. PAGOS PENDIENTES (no vencidos, programados a futuro o hoy)
    const pagosPendientesQuery = `
      SELECT 
        COUNT(*) as cantidad,
        COALESCE(SUM(scheduled_amount - COALESCE(paid_amount, 0)), 0) as total
      FROM CONTRACT_PLAN_PAYMENTS
      WHERE payment_status IN ('Pendiente', 'Parcial')
        AND scheduled_date >= CURRENT_DATE
    `;
    const pagosPendientesResult = await pool.query(pagosPendientesQuery);
    const pagosPendientes = {
      cantidad: parseInt(pagosPendientesResult.rows[0].cantidad || 0),
      total: parseFloat(pagosPendientesResult.rows[0].total || 0),
    };

    // 2. PAGOS VENCIDOS (atrasados, fecha pasada sin completar)
    const pagosVencidosQuery = `
      SELECT 
        COUNT(*) as cantidad,
        COALESCE(SUM(scheduled_amount - COALESCE(paid_amount, 0)), 0) as adeudo
      FROM CONTRACT_PLAN_PAYMENTS
      WHERE payment_status IN ('Pendiente', 'Vencido', 'Parcial')
        AND scheduled_date < CURRENT_DATE
    `;
    const pagosVencidosResult = await pool.query(pagosVencidosQuery);
    const pagosVencidos = {
      cantidad: parseInt(pagosVencidosResult.rows[0].cantidad || 0),
      adeudo: parseFloat(pagosVencidosResult.rows[0].adeudo || 0),
    };

    // 3. CONTRATOS POR VENCER (usando placement_date + contract_duration en meses)
    const contratosVencimientoQuery = `
      SELECT 
        COUNT(*) FILTER (
          WHERE placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(contract_duration, '[^0-9]', '', 'g') AS INTEGER) < CURRENT_DATE
        ) as vencidos,
        COUNT(*) FILTER (
          WHERE placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(contract_duration, '[^0-9]', '', 'g') AS INTEGER) >= CURRENT_DATE
            AND placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(contract_duration, '[^0-9]', '', 'g') AS INTEGER) <= CURRENT_DATE + INTERVAL '30 days'
        ) as proximos30dias
      FROM CLIENTS
      WHERE placement_date IS NOT NULL
        AND contract_duration IS NOT NULL
        AND contract_duration != ''
    `;
    const contratosVencimientoResult = await pool.query(contratosVencimientoQuery);

    const contratosVencimiento = {
      vencidos: parseInt(contratosVencimientoResult.rows[0]?.vencidos || '0'),
      proximos30Dias: parseInt(contratosVencimientoResult.rows[0]?.proximos30dias || '0'),
    };

    // 4. INGRESOS DEL MES (pagos recibidos este mes)
    const ingresosMesQuery = `
      SELECT 
        COUNT(*) as cantidadPagos,
        COALESCE(SUM(paid_amount), 0) as total
      FROM CONTRACT_PLAN_PAYMENTS
      WHERE paid_date IS NOT NULL
        AND EXTRACT(MONTH FROM paid_date) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM paid_date) = EXTRACT(YEAR FROM CURRENT_DATE)
    `;
    const ingresosMesResult = await pool.query(ingresosMesQuery);
    const ingresosDelMes = {
      total: parseFloat(ingresosMesResult.rows[0].total || 0),
      cantidadPagos: parseInt(ingresosMesResult.rows[0].cantidadpagos || 0),
    };

    // 5. Total de clientes activos (para referencia)
    const clientesActivosQuery = `
      SELECT COUNT(*) as total
      FROM CLIENTS
      WHERE status IN ('Pendiente de colocación', 'Colocado')
    `;
    const clientesActivosResult = await pool.query(clientesActivosQuery);
    const totalClientesActivos = parseInt(clientesActivosResult.rows[0].total || 0);

    // 6. Adeudo total pendiente (suma de todos los adeudos)
    const adeudoTotalQuery = `
      SELECT COALESCE(SUM(scheduled_amount - COALESCE(paid_amount, 0)), 0) as total
      FROM CONTRACT_PLAN_PAYMENTS
      WHERE payment_status IN ('Pendiente', 'Vencido', 'Parcial')
    `;
    const adeudoTotalResult = await pool.query(adeudoTotalQuery);
    const adeudoTotalPendiente = parseFloat(adeudoTotalResult.rows[0].total || 0);

    // 7. Pagos programados para esta semana
    const pagosSemanaQuery = `
      SELECT COUNT(*) as total, COALESCE(SUM(scheduled_amount), 0) as monto
      FROM CONTRACT_PLAN_PAYMENTS
      WHERE scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        AND payment_status IN ('Pendiente', 'Parcial')
    `;
    const pagosSemanaResult = await pool.query(pagosSemanaQuery);
    const pagosProgramadosSemana = {
      cantidad: parseInt(pagosSemanaResult.rows[0].total || 0),
      monto: parseFloat(pagosSemanaResult.rows[0].monto || 0),
    };

    // 8. Clientes por tipo de venta
    const clientesTipoVentaQuery = `
      SELECT 
        CASE 
          WHEN payment_frequency = 'Contado' THEN 'Contado'
          ELSE 'Crédito'
        END as tipo,
        COUNT(*) as total
      FROM CLIENTS
      WHERE status IN ('Pendiente de colocación', 'Colocado')
      GROUP BY tipo
    `;
    const clientesTipoVentaResult = await pool.query(clientesTipoVentaQuery);
    const clientesPorTipoVenta = clientesTipoVentaResult.rows.reduce(
      (acc: any, row: any) => {
        acc[row.tipo] = parseInt(row.total);
        return acc;
      },
      { Contado: 0, Crédito: 0 }
    );

    // 9. Últimos pagos realizados (5 más recientes)
    const ultimosPagosQuery = `
      SELECT 
        p.payment_id as id,
        p.client_id as "clienteId",
        c.defendant_name as "clienteNombre",
        c.contract_number as "numeroContrato",
        p.paid_amount as monto,
        p.paid_date as fecha,
        p.payment_type as tipo,
        pl.contract_type as "tipoContrato"
      FROM CONTRACT_PLAN_PAYMENTS p
      INNER JOIN CLIENTS c ON p.client_id = c.client_id
      INNER JOIN CONTRACT_PAYMENT_PLANS pl ON p.plan_id = pl.plan_id
      WHERE p.paid_date IS NOT NULL
      ORDER BY p.paid_date DESC
      LIMIT 5
    `;
    const ultimosPagosResult = await pool.query(ultimosPagosQuery);
    const ultimosPagos = ultimosPagosResult.rows;

    // 10. Clientes con mayor adeudo
    const clientesMayorAdeudoQuery = `
      SELECT 
        c.client_id as id,
        c.defendant_name as nombre,
        c.contract_number as "numeroContrato",
        COALESCE(SUM(p.scheduled_amount - COALESCE(p.paid_amount, 0)), 0) as adeudo
      FROM CLIENTS c
      LEFT JOIN CONTRACT_PLAN_PAYMENTS p ON c.client_id = p.client_id 
        AND p.payment_status IN ('Pendiente', 'Vencido', 'Parcial')
      WHERE c.status IN ('Pendiente de colocación', 'Colocado')
      GROUP BY c.client_id, c.defendant_name, c.contract_number
      HAVING COALESCE(SUM(p.scheduled_amount - COALESCE(p.paid_amount, 0)), 0) > 0
      ORDER BY adeudo DESC
      LIMIT 5
    `;
    const clientesMayorAdeudoResult = await pool.query(clientesMayorAdeudoQuery);
    const clientesMayorAdeudo = clientesMayorAdeudoResult.rows;

    // 11. Detalle de contratos vencidos (usando placement_date)
    const contratosVencidosDetalleQuery = `
      SELECT 
        c.client_id as id,
        c.defendant_name as nombre,
        c.contract_number as "numeroContrato",
        c.status as estado,
        c.placement_date as "fechaColocacion",
        c.contract_duration as "duracion",
        c.placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER) as "fechaVencimiento",
        CURRENT_DATE - (c.placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER)) as "diasVencido"
      FROM CLIENTS c
      WHERE c.placement_date IS NOT NULL
        AND c.contract_duration IS NOT NULL
        AND c.contract_duration != ''
        AND c.placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER) < CURRENT_DATE
      ORDER BY "fechaVencimiento" ASC
      LIMIT 10
    `;
    const contratosVencidosDetalleResult = await pool.query(contratosVencidosDetalleQuery);
    const contratosVencidosDetalle = contratosVencidosDetalleResult.rows;

    // 12. Detalle de contratos próximos a vencer (próximos 30 días)
    const contratosProximosVencerQuery = `
      SELECT 
        c.client_id as id,
        c.defendant_name as nombre,
        c.contract_number as "numeroContrato",
        c.status as estado,
        c.placement_date as "fechaColocacion",
        c.contract_duration as "duracion",
        c.placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER) as "fechaVencimiento",
        (c.placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER)) - CURRENT_DATE as "diasRestantes"
      FROM CLIENTS c
      WHERE c.placement_date IS NOT NULL
        AND c.contract_duration IS NOT NULL
        AND c.contract_duration != ''
        AND c.placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER) >= CURRENT_DATE
        AND c.placement_date + INTERVAL '1 month' * CAST(REGEXP_REPLACE(c.contract_duration, '[^0-9]', '', 'g') AS INTEGER) <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY "fechaVencimiento" ASC
      LIMIT 10
    `;
    const contratosProximosVencerResult = await pool.query(contratosProximosVencerQuery);
    const contratosProximosVencer = contratosProximosVencerResult.rows;

    // 13. Total de clientes por tipo de brazalete
    const clientesPorBrazaleteQuery = `
      SELECT 
        COALESCE(bracelet_type, 'Sin especificar') as "tipoBrazalete",
        COUNT(*) as total
      FROM CLIENTS
      WHERE status IN ('Pendiente de colocación', 'Colocado')
      GROUP BY bracelet_type
      ORDER BY total DESC
    `;
    const clientesPorBrazaleteResult = await pool.query(clientesPorBrazaleteQuery);
    const clientesPorBrazalete = clientesPorBrazaleteResult.rows;

    // 14. Total de clientes pendientes de instalación
    const pendientesInstalacionQuery = `
      SELECT COUNT(*) as total
      FROM CLIENTS
      WHERE status = 'Pendiente de colocación'
    `;
    const pendientesInstalacionResult = await pool.query(pendientesInstalacionQuery);
    const totalPendientesInstalacion = parseInt(pendientesInstalacionResult.rows[0].total || 0);

    // 15. Total de clientes pendientes de audiencia
    const pendientesAudienciaQuery = `
      SELECT COUNT(*) as total
      FROM CLIENTS
      WHERE status = 'Pendiente de audiencia'
    `;
    const pendientesAudienciaResult = await pool.query(pendientesAudienciaQuery);
    const totalPendientesAudiencia = parseInt(pendientesAudienciaResult.rows[0].total || 0);

    // 16. Total de clientes pendientes de aprobación
    const pendientesAprobacionQuery = `
      SELECT COUNT(*) as total
      FROM CLIENTS
      WHERE status = 'Pendiente de aprobación'
    `;
    const pendientesAprobacionResult = await pool.query(pendientesAprobacionQuery);
    const totalPendientesAprobacion = parseInt(pendientesAprobacionResult.rows[0].total || 0);

    // 17. Pagos acumulados por año (todos los años registrados)
    const pagosAcumuladosAnioQuery = `
      SELECT 
        EXTRACT(YEAR FROM paid_date) as anio,
        COUNT(*) as "cantidadPagos",
        COALESCE(SUM(paid_amount), 0) as "totalPagado"
      FROM CONTRACT_PLAN_PAYMENTS
      WHERE paid_date IS NOT NULL
      GROUP BY EXTRACT(YEAR FROM paid_date)
      ORDER BY anio DESC
    `;
    const pagosAcumuladosAnioResult = await pool.query(pagosAcumuladosAnioQuery);

    // Convertir el resultado en un objeto por año
    const pagosAcumuladosAnio: any = {};
    let totalHistoricoPagos = 0;
    let cantidadHistoricoPagos = 0;

    pagosAcumuladosAnioResult.rows.forEach((row: any) => {
      const anio = parseInt(row.anio);
      const total = parseFloat(row.totalPagado || 0);
      const cantidad = parseInt(row.cantidadPagos || 0);

      pagosAcumuladosAnio[anio] = {
        total,
        cantidadPagos: cantidad,
      };

      totalHistoricoPagos += total;
      cantidadHistoricoPagos += cantidad;
    });

    // Total acumulado de todos los años
    const totalAcumuladoHistorico = {
      total: totalHistoricoPagos,
      cantidadPagos: cantidadHistoricoPagos,
    };

    // 18. Saldos deudores pendientes de pago por año
    const saldosDeudoresPorAnioQuery = `
      SELECT 
        EXTRACT(YEAR FROM scheduled_date) as anio,
        COUNT(*) as "cantidadPagos",
        COALESCE(SUM(scheduled_amount - COALESCE(paid_amount, 0)), 0) as "totalAdeudo"
      FROM CONTRACT_PLAN_PAYMENTS
      WHERE payment_status IN ('Pendiente', 'Vencido', 'Parcial')
      GROUP BY EXTRACT(YEAR FROM scheduled_date)
      ORDER BY anio DESC
    `;
    const saldosDeudoresPorAnioResult = await pool.query(saldosDeudoresPorAnioQuery);

    // Convertir el resultado en un objeto por año
    const saldosDeudoresPorAnio: any = {};
    let totalHistoricoAdeudo = 0;
    let cantidadHistoricoAdeudo = 0;

    saldosDeudoresPorAnioResult.rows.forEach((row: any) => {
      const anio = parseInt(row.anio);
      const total = parseFloat(row.totalAdeudo || 0);
      const cantidad = parseInt(row.cantidadPagos || 0);

      saldosDeudoresPorAnio[anio] = {
        totalAdeudo: total,
        cantidadPagos: cantidad,
      };

      totalHistoricoAdeudo += total;
      cantidadHistoricoAdeudo += cantidad;
    });

    // Total de adeudos de todos los años
    const totalAdeudoHistorico = {
      totalAdeudo: totalHistoricoAdeudo,
      cantidadPagos: cantidadHistoricoAdeudo,
    };

    // Construir respuesta optimizada para el frontend
    const dashboardData = {
      // Tarjetas principales del dashboard
      pagosPendientes: {
        cantidad: pagosPendientes.cantidad,
        total: pagosPendientes.total,
      },
      pagosVencidos: {
        cantidad: pagosVencidos.cantidad,
        adeudo: pagosVencidos.adeudo,
      },
      contratosPorVencer: {
        vencidos: contratosVencimiento.vencidos,
        proximos30Dias: contratosVencimiento.proximos30Dias,
      },
      ingresosDelMes: {
        total: ingresosDelMes.total,
        cantidadPagos: ingresosDelMes.cantidadPagos,
      },
      pagosAcumuladosAnio, // Objeto con totales por año { 2024: { total, cantidadPagos }, 2025: {...}, ... }
      totalAcumuladoHistorico, // Total acumulado de todos los años
      saldosDeudoresPorAnio, // Objeto con adeudos pendientes por año { 2024: { totalAdeudo, cantidadPagos }, 2025: {...}, ... }
      totalAdeudoHistorico, // Total de adeudos pendientes de todos los años

      // Información adicional
      resumen: {
        totalClientesActivos,
        adeudoTotalPendiente,
        totalPendientesInstalacion,
        totalPendientesAudiencia,
        totalPendientesAprobacion,
      },
      pagosProgramadosSemana,
      clientesPorTipoVenta,
      clientesPorBrazalete,
      ultimosPagos,
      clientesMayorAdeudo,
      contratosVencidosDetalle, // Lista de los 10 contratos más antiguos vencidos
      contratosProximosVencer, // Lista de los 10 contratos que vencen en próximos 30 días
      fechaActualizacion: new Date().toISOString(),
    };

    return res.status(200).json({
      success: true,
      data: dashboardData,
      message: 'Resumen del dashboard obtenido correctamente',
    });
  } catch (error: any) {
    console.error('Error al obtener resumen del dashboard:', error);
    next(error);
  }
};

/**
 * Obtener métricas de pagos por mes (para gráficas)
 */
export const getPaymentMetrics = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  try {
    const { meses = 6 } = req.query; // Últimos 6 meses por defecto

    const query = `
      SELECT 
        TO_CHAR(paid_date, 'YYYY-MM') as mes,
        COUNT(*) as "cantidadPagos",
        COALESCE(SUM(paid_amount), 0) as "totalPagado"
      FROM CLIENT_PAYMENTS
      WHERE paid_date IS NOT NULL
        AND paid_date >= CURRENT_DATE - INTERVAL '${meses} months'
      GROUP BY mes
      ORDER BY mes DESC
    `;

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      data: result.rows,
      message: 'Métricas de pagos obtenidas correctamente',
    });
  } catch (error: any) {
    console.error('Error al obtener métricas:', error);
    next(error);
  }
};
