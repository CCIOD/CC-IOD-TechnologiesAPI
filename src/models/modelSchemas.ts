import Joi from 'joi';
import {
  arrValuesValidation,
  dateValidation,
  emailValidation,
  fieldIdValidation,
  numberPositiveValidation,
  observationsValidation,
  passwordValidation,
  paymentFrequencyValidation,
  phoneValidation,
  roleIdValidation,
  statusValidation,
  stringValidation,
  timeValidation,
} from '../helpers/JOIValidations';

const name = { name: stringValidation() };
const email = { email: emailValidation };
const contact_schema = Joi.object({
  contact_name: stringValidation('nombre del contacto'),
  relationship: Joi.string().max(100).optional().allow('', null).default('Familiar').messages({
    'string.base': 'La relación debe ser texto',
    'string.max': 'La relación no puede exceder 100 caracteres',
  }),
  phone_number: phoneValidation,
});

const contact_numbers = {
  contact_numbers: Joi.array().items(contact_schema).min(1).required().messages({
    'array.base': 'Los contactos deben estar en un arreglo',
    'any.required': 'Los contactos son requeridos.',
    'array.min': 'Debe haber al menos un contacto.',
  }),
};

// Schema para audiencias
const hearing_schema = Joi.object({
  hearing_id: Joi.number().integer().positive().optional().strip(),
  hearing_date: dateValidation('fecha de audiencia'),
  hearing_location: stringValidation('lugar de audiencia'),
  attendees: Joi.array().items(Joi.string().trim()).min(0).optional().default([]).messages({
    'array.base': 'Los asistentes deben estar en un arreglo',
  }),
  notes: Joi.string().optional().allow('', null),
  created_at: Joi.date().optional().strip(),
  updated_at: Joi.date().optional().strip(),
}).options({ stripUnknown: true });

const hearings = {
  hearings: Joi.array().items(hearing_schema).optional().messages({
    'array.base': 'Las audiencias deben ser un arreglo válido',
    'array.items': 'Cada audiencia debe tener una estructura válida',
  }),
};

const observationSchema = Joi.object({
  date: dateValidation('fecha de la observación'),
  observation: stringValidation('observación'),
});

export const prospectSchema = Joi.object({
  ...name,
  ...email,
  phone: phoneValidation,
  relationship: Joi.string().max(100).optional().allow(null, ''),
  status: statusValidation({
    allowedValues: ['Pendiente', 'Aprobado'],
    field: 'estado',
  }),
  date: dateValidation(),
  observations: Joi.array().items(observationSchema).optional(),
});

export const clientSchema = Joi.object({
  contract_number: Joi.alternatives()
    .try(Joi.number().integer().min(1), Joi.string().pattern(/^[1-9]\d*$/, 'valid number'))
    .optional()
    .allow(null)
    .messages({
      'alternatives.match': 'El número de contrato debe ser un número entero positivo',
      'number.base': 'El número de contrato debe ser un número',
      'number.integer': 'El número de contrato debe ser un número entero',
      'number.min': 'El número de contrato debe ser mayor que 0',
      'string.pattern.base': 'El número de contrato debe contener solo dígitos y ser mayor que 0',
      'string.pattern.name': 'El número de contrato debe ser un número válido',
    }),
  contract_folio: Joi.string().optional().allow('', null).messages({
    'string.base': 'El folio del contrato debe ser texto',
  }),
  bracelet_type: Joi.string().optional().allow('', null).messages({
    'string.base': 'El tipo de brazalete debe ser texto',
  }),
  defendant_name: stringValidation('El nombre del imputado'),
  criminal_case: stringValidation('La causa penal'),
  investigation_file_number: stringValidation('El número de carpeta de investigación'),
  judge_name: stringValidation('El nombre del Juez'),
  court_name: stringValidation('El nombre del Juzgado'),
  lawyer_name: stringValidation('El nombre del Abogado'),
  signer_name: stringValidation('El nombre de quién firma el contrato'),
  ...contact_numbers,
  placement_date: dateValidation('fecha de colocación').optional().allow('', null),
  ...hearings,
  contract_date: Joi.date().iso().optional().allow('', null).messages({
    'date.base': 'La fecha del contrato debe ser una fecha válida.',
    'date.isoDate': 'El formato de la fecha del contrato debe ser válido (YYYY-MM-DD o ISO 8601).',
  }),
  contract_document: Joi.string().optional().allow('', null),
  contract_duration: Joi.string().optional().allow('', null),
  payment_day: Joi.number().integer().min(1).max(31).optional().messages({
    'number.base': 'El día de pago debe ser un número',
    'number.integer': 'El día de pago debe ser un número entero',
    'number.min': 'El día de pago debe ser entre 1 y 31',
    'number.max': 'El día de pago debe ser entre 1 y 31',
  }),
  payment_frequency: paymentFrequencyValidation.optional(),
  status: statusValidation({
    allowedValues: ['Pendiente de aprobación', 'Pendiente de audiencia', 'Pendiente de colocación', 'Colocado', 'Desinstalado', 'Cancelado'],
    field: 'estado',
  }),
  cancellation_reason: Joi.string().optional().allow('', null).messages({
    'string.base': 'El motivo de cancelación debe ser texto',
  }),
  observations: Joi.array().items(observationSchema).optional(),
  prospect_id: fieldIdValidation({
    field: 'prospecto',
    req: 'Debe haber un prospecto a la cuál definir como cliente.',
  }),
});

export const carrierSchema = Joi.object({
  residence_area: stringValidation('La Zona de residencia'),
  placement_date: dateValidation('fecha de colocación').optional().allow('', null),
  placement_time: timeValidation,
  electronic_bracelet: stringValidation('El brazalete electrónico'),
  beacon: stringValidation('El BEACON'),
  wireless_charger: stringValidation('El cargador inalámbrico'),
  information_emails: arrValuesValidation('email'),
  ...contact_numbers,
  house_arrest: stringValidation('El arraigo domiciliario'),
  installer_name: stringValidation('El nombre del instalador'),
  observations: Joi.any().optional(), // Permite cualquier tipo de observaciones
  client_id: fieldIdValidation({
    field: 'cliente',
    req: 'Debe haber un cliente a la cuál definir como portador.',
  }),
  relationship: Joi.string().max(100).optional().allow(null, ''),
});

// --------------- AUTH ------------------------------

export const registerSchema = Joi.object({
  ...name,
  ...roleIdValidation,
  ...email,
  ...passwordValidation,
});
export const updateUserSchema = Joi.object({
  ...name,
  ...roleIdValidation,
});

// --------------- HEARINGS ------------------------------

export const createHearingSchema = Joi.object({
  client_id: fieldIdValidation({
    field: 'cliente',
    req: 'Debe especificar el ID del cliente para la audiencia.',
  }),
  hearing_date: dateValidation('fecha de audiencia'),
  hearing_location: stringValidation('lugar de audiencia'),
  attendees: Joi.array().items(Joi.string().trim()).min(0).required().messages({
    'array.base': 'Los asistentes deben estar en un arreglo',
    'any.required': 'La lista de asistentes es requerida.',
  }),
  notes: Joi.string().optional().allow('', null),
});

export const updateHearingSchema = Joi.object({
  hearing_date: dateValidation('fecha de audiencia').optional(),
  hearing_location: stringValidation('lugar de audiencia').optional(),
  attendees: Joi.array().items(Joi.string().trim()).min(0).optional().messages({
    'array.base': 'Los asistentes deben estar en un arreglo',
  }),
  notes: Joi.string().optional().allow('', null),
});

export const hearingParamsSchema = Joi.object({
  hearing_id: Joi.number().integer().positive().required().messages({
    'number.base': 'El ID de la audiencia debe ser un número',
    'number.integer': 'El ID de la audiencia debe ser un número entero',
    'number.positive': 'El ID de la audiencia debe ser positivo',
    'any.required': 'El ID de la audiencia es requerido',
  }),
});
export const updateAdminSchema = Joi.object({ ...name });
export const loginSchema = Joi.object({ ...email, ...passwordValidation });
export const changePassSchema = Joi.object({ ...passwordValidation });
export const emailSchema = Joi.object({ ...email });

// Esquema para desinstalación de clientes
export const uninstallClientSchema = Joi.object({
  uninstall_reason: stringValidation('motivo de desinstalación').optional(),
  uninstall_date: dateValidation('fecha de desinstalación').optional(),
});

export const carrierActSchema = Joi.object({
  act_title: stringValidation('título del acta').max(255),
  act_description: stringValidation('descripción del acta').optional().allow(''),
});

// Schemas para renovaciones de contrato
export const createRenewalSchema = Joi.object({
  client_id: fieldIdValidation({
    field: 'cliente',
    req: 'Debe especificar el ID del cliente para la renovación.',
  }),
  renewal_date: dateValidation('fecha de renovación'),
  renewal_document: Joi.string().optional().allow('', null),
  renewal_duration: stringValidation('duración de renovación').optional().allow('', null).max(50),
  notes: Joi.string().optional().allow('', null),
});

export const updateRenewalSchema = Joi.object({
  renewal_date: dateValidation('fecha de renovación').optional(),
  renewal_document: Joi.string().optional().allow('', null),
  renewal_duration: stringValidation('duración de renovación').optional().allow('', null).max(50),
  renewal_amount: Joi.number().positive().optional().allow(null).messages({
    'number.base': 'El monto de renovación debe ser un número',
    'number.positive': 'El monto de renovación debe ser un valor positivo',
  }),
  payment_frequency: Joi.string().optional().allow('', null).valid('Mensual', 'Bimestral', 'Trimestral', 'Semestral', 'Contado').messages({
    'any.only': 'La frecuencia de pago debe ser: Mensual, Bimestral, Trimestral, Semestral o Contado',
  }),
  notes: Joi.string().optional().allow('', null),
})
  .min(1)
  .messages({
    'object.min': 'Debe proporcionar al menos un campo para actualizar',
  });

export const renewalParamsSchema = Joi.object({
  renewal_id: Joi.number().integer().positive().required().messages({
    'number.base': 'El ID de la renovación debe ser un número',
    'number.integer': 'El ID de la renovación debe ser un número entero',
    'number.positive': 'El ID de la renovación debe ser positivo',
    'any.required': 'El ID de la renovación es requerido',
  }),
});

// Schemas para oficios de fiscalía
export const createProsecutorDocSchema = Joi.object({
  client_id: fieldIdValidation({
    field: 'cliente',
    req: 'Debe especificar el ID del cliente para el oficio.',
  }),
  document_type: stringValidation('tipo de documento').max(100),
  document_number: stringValidation('número de documento').optional().allow('', null).max(50),
  issue_date: dateValidation('fecha de emisión'),
  document_file: Joi.string().optional().allow('', null),
  prosecutor_office: stringValidation('fiscalía emisora').optional().allow('', null).max(200),
  notes: Joi.string().optional().allow('', null),
});

export const updateProsecutorDocSchema = Joi.object({
  document_type: stringValidation('tipo de documento').optional().max(100),
  document_number: stringValidation('número de documento').optional().allow('', null).max(50),
  issue_date: dateValidation('fecha de emisión').optional(),
  document_file: Joi.string().optional().allow('', null),
  prosecutor_office: stringValidation('fiscalía emisora').optional().allow('', null).max(200),
  notes: Joi.string().optional().allow('', null),
})
  .min(1)
  .messages({
    'object.min': 'Debe proporcionar al menos un campo para actualizar',
  });

export const prosecutorDocParamsSchema = Joi.object({
  prosecutor_doc_id: Joi.number().integer().positive().required().messages({
    'number.base': 'El ID del oficio debe ser un número',
    'number.integer': 'El ID del oficio debe ser un número entero',
    'number.positive': 'El ID del oficio debe ser positivo',
    'any.required': 'El ID del oficio es requerido',
  }),
});

// --------------- PAYMENTS --------------------------------

export const createPaymentSchema = Joi.object({
  client_id: fieldIdValidation({
    field: 'cliente',
    req: 'Debe especificar el ID del cliente para el pago.',
  }),
  payment_date: dateValidation('fecha de pago'),
  amount: Joi.number().positive().required().messages({
    'number.base': 'El monto debe ser un número',
    'number.positive': 'El monto debe ser mayor a 0',
    'any.required': 'El monto es requerido',
  }),
  payment_type: stringValidation('tipo de pago').required(),
  observations: Joi.string().optional().allow('', null).messages({
    'string.base': 'Las observaciones deben ser texto',
  }),
});

export const createPaymentAdminSchema = Joi.object({
  client_id: fieldIdValidation({
    field: 'cliente',
    req: 'Debe especificar el ID del cliente.',
  }).optional(), // client_id viene en params
  payment_type: Joi.string().valid('Pago', 'Viático', 'Abono', 'Otro').optional().default('Pago').messages({
    'any.only': 'El tipo debe ser uno de: Pago, Viático, Abono, Otro',
  }),
  scheduled_amount: Joi.alternatives()
    .try(Joi.number().positive(), Joi.string().pattern(/^\d+(\.\d{1,2})?$/))
    .optional()
    .messages({
      'alternatives.match': 'El importe debe ser un número positivo válido',
    }),
  scheduled_date: Joi.date().iso().optional().allow('', null).messages({
    'date.base': 'La fecha programada debe ser una fecha válida',
    'date.isoDate': 'El formato de fecha debe ser válido (YYYY-MM-DD)',
  }),
  paid_amount: Joi.alternatives()
    .try(Joi.number().min(0), Joi.string().pattern(/^\d+(\.\d{1,2})?$/))
    .optional()
    .allow('', null),
  paid_date: Joi.date().iso().optional().allow('', null),
  payment_status: Joi.string().valid('Pendiente', 'Pagado', 'Parcial', 'Vencido', 'Cancelado').optional().messages({
    'any.only': 'El estado debe ser uno de: Pendiente, Pagado, Parcial, Vencido, Cancelado',
  }),
  description: Joi.string().optional().allow('', null).max(500),
  payment_method: Joi.string().optional().allow('', null),
  reference_number: Joi.string().optional().allow('', null).max(100),
  notes: Joi.string().optional().allow('', null),
  // Campos en español
  tipo: Joi.string().optional().allow('', null),
  importeProgramado: Joi.alternatives()
    .try(Joi.number().positive(), Joi.string().pattern(/^\d+(\.\d{1,2})?$/))
    .optional(),
  fechaProgramada: Joi.date().iso().optional().allow('', null),
  importePagado: Joi.alternatives()
    .try(Joi.number().min(0), Joi.string().pattern(/^\d+(\.\d{1,2})?$/))
    .optional()
    .allow('', null),
  fechaPagoReal: Joi.date().iso().optional().allow('', null),
  descripcion: Joi.string().optional().allow('', null).max(500),
  metodoPago: Joi.string().optional().allow('', null),
  numeroReferencia: Joi.string().optional().allow('', null).max(100),
  notas: Joi.string().optional().allow('', null),
})
  .min(1)
  .messages({
    'object.min': 'Debe proporcionar al menos un campo',
  });

export const createPaymentAdminBatchSchema = Joi.object({
  payments: Joi.array()
    .items(
      Joi.object({
        payment_number: Joi.number().integer().positive().optional(),
        scheduled_amount: Joi.alternatives()
          .try(Joi.number().positive(), Joi.string().pattern(/^\d+(\.\d{1,2})?$/))
          .required()
          .messages({
            'alternatives.match': 'El importe debe ser un número positivo válido',
            'any.required': 'El importe programado es requerido',
          }),
        scheduled_date: dateValidation('fecha programada'),
        payment_status: Joi.string().valid('Pendiente', 'Pagado', 'Parcial', 'Vencido', 'Cancelado').optional().default('Pendiente'),
        paid_amount: Joi.alternatives()
          .try(Joi.number().min(0), Joi.string().pattern(/^\d+(\.\d{1,2})?$/))
          .optional()
          .allow('', null),
        paid_date: Joi.date().iso().optional().allow('', null),
        description: Joi.string().optional().allow('', null).max(500),
        payment_method: Joi.string().optional().allow('', null),
        reference_number: Joi.string().optional().allow('', null).max(100),
        notes: Joi.string().optional().allow('', null),
        payment_type: Joi.string().valid('Pago', 'Viático', 'Abono', 'Otro').optional().default('Pago').messages({
          'any.only': 'El tipo debe ser uno de: Pago, Viático, Abono, Otro',
        }),
      })
    )
    .min(1)
    .required()
    .messages({
      'array.base': 'Los pagos deben estar en un arreglo',
      'array.min': 'Debe haber al menos un pago',
      'any.required': 'Los pagos son requeridos',
    }),
});

export const createBatchPaymentsSchema = Joi.object({
  client_id: fieldIdValidation({
    field: 'cliente',
    req: 'Debe especificar el ID del cliente.',
  }),
  payments: Joi.array()
    .items(
      Joi.object({
        payment_number: Joi.number().integer().positive().optional().messages({
          'number.base': 'El número de pago debe ser un número',
          'number.positive': 'El número de pago debe ser positivo',
        }),
        scheduled_amount: Joi.alternatives()
          .try(Joi.number().positive(), Joi.string().pattern(/^\d+(\.\d{1,2})?$/))
          .required()
          .messages({
            'alternatives.match': 'El importe debe ser un número positivo válido',
            'any.required': 'El importe programado es requerido',
          }),
        scheduled_date: dateValidation('fecha programada'),
        payment_status: Joi.string().valid('Pendiente', 'Pagado', 'Parcial', 'Vencido', 'Cancelado').optional().default('Pendiente').messages({
          'any.only': 'El estado debe ser uno de: Pendiente, Pagado, Parcial, Vencido, Cancelado',
        }),
        paid_amount: Joi.alternatives()
          .try(Joi.number().min(0), Joi.string().pattern(/^\d+(\.\d{1,2})?$/))
          .optional()
          .allow('', null)
          .messages({
            'number.base': 'El importe pagado debe ser un número',
          }),
        paid_date: Joi.date().iso().optional().allow('', null).messages({
          'date.base': 'La fecha de pago debe ser una fecha válida',
          'date.isoDate': 'El formato de fecha debe ser válido (YYYY-MM-DD)',
        }),
        description: Joi.string().optional().allow('', null).max(500).messages({
          'string.base': 'La descripción debe ser texto',
          'string.max': 'La descripción no puede exceder 500 caracteres',
        }),
        payment_method: Joi.string().optional().allow('', null).messages({
          'string.base': 'El método de pago debe ser texto',
        }),
        reference_number: Joi.string().optional().allow('', null).max(100).messages({
          'string.base': 'El número de referencia debe ser texto',
          'string.max': 'El número de referencia no puede exceder 100 caracteres',
        }),
        notes: Joi.string().optional().allow('', null).messages({
          'string.base': 'Las notas deben ser texto',
        }),
      })
    )
    .min(1)
    .required()
    .messages({
      'array.base': 'Los pagos deben estar en un arreglo',
      'array.min': 'Debe haber al menos un pago',
      'any.required': 'Los pagos son requeridos',
    }),
});

export const updatePaymentSchema = Joi.object({
  payment_date: dateValidation('fecha de pago').optional(),
  amount: Joi.number().positive().optional().messages({
    'number.base': 'El monto debe ser un número',
    'number.positive': 'El monto debe ser mayor a 0',
  }),
  payment_type: stringValidation('tipo de pago').optional(),
  observations: Joi.string().optional().allow('', null),
})
  .min(1)
  .messages({
    'object.min': 'Debe proporcionar al menos un campo para actualizar',
  });

export const paymentParamsSchema = Joi.object({
  payment_id: Joi.number().integer().positive().required().messages({
    'number.base': 'El ID del pago debe ser un número',
    'number.integer': 'El ID del pago debe ser un número entero',
    'number.positive': 'El ID del pago debe ser positivo',
    'any.required': 'El ID del pago es requerido',
  }),
});
// 107
