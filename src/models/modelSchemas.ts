import Joi from "joi";
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
} from "../helpers/JOIValidations";

const name = { name: stringValidation() };
const email = { email: emailValidation };
const contact_schema = Joi.object({
  contact_name: stringValidation("nombre del contacto"),
  relationship_id: Joi.alternatives()
    .try(
      Joi.number().integer().positive(),
      Joi.string().pattern(/^\d+$/).custom((value, helpers) => {
        const num = parseInt(value, 10);
        if (isNaN(num) || num <= 0) {
          return helpers.error('any.invalid');
        }
        return num;
      })
    )
    .optional()
    .messages({
      'alternatives.match': 'El ID de parentesco debe ser un número positivo',
      'any.invalid': 'El ID de parentesco debe ser un número válido',
    }),
  phone_number: phoneValidation,
  relationship_name: Joi.string().optional().allow(null, ''),
});

const contact_numbers = { 
  contact_numbers: Joi.array().items(contact_schema).min(1).required().messages({
    'array.base': 'Los contactos deben estar en un arreglo',
    'any.required': 'Los contactos son requeridos.',
    'array.min': 'Debe haber al menos un contacto.',
  })
};

// Schema para audiencias
const hearing_schema = Joi.object({
  hearing_id: Joi.number().integer().positive().optional().strip(),
  hearing_date: dateValidation("fecha de audiencia"),
  hearing_location: stringValidation("lugar de audiencia"),
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
    'array.items': 'Cada audiencia debe tener una estructura válida'
  })
};
const relationship_id = {
  relationship_id: fieldIdValidation({
    field: "parentesco",
    allowedValues: [1, 2],
    allowedMsg: "Familiar o Abogado",
  }),
};

const observationSchema = Joi.object({
  date: dateValidation("fecha de la observación"),
  observation: stringValidation("observación"),
});

export const prospectSchema = Joi.object({
  ...name,
  ...email,
  phone: phoneValidation,
  ...relationship_id,
  status: statusValidation({
    allowedValues: ["Pendiente", "Aprobado"],
    field: "estado",
  }),
  date: dateValidation(),
  observations: Joi.array().items(observationSchema).optional(),
});

export const clientSchema = Joi.object({
  contract_number: Joi.alternatives()
    .try(
      Joi.number().integer().min(1),
      Joi.string().pattern(/^[1-9]\d*$/, 'valid number')
    )
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
  defendant_name: stringValidation("El nombre del imputado"),
  criminal_case: stringValidation("La causa penal"),
  investigation_file_number: numberPositiveValidation(
    "número de carpeta de investigación",
    true
  ),
  judge_name: stringValidation("El nombre del Juez"),
  court_name: stringValidation("El nombre del Juzgado"),
  lawyer_name: stringValidation("El nombre del Abogado"),
  signer_name: stringValidation("El nombre de quién firma el contrato"),
  ...contact_numbers,
  placement_date: dateValidation("fecha de colocación").optional(),
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
    allowedValues: [
      "Pendiente de aprobación",
      "Pendiente de audiencia",
      "Pendiente de colocación",
      "Colocado",
      "Desinstalado",
      "Cancelado",
    ],
    field: "estado",
  }),
  cancellation_reason: Joi.string().optional().allow('', null).messages({
    'string.base': 'El motivo de cancelación debe ser texto',
  }),
  observations: Joi.array().items(observationSchema).optional(),
  prospect_id: fieldIdValidation({
    field: "prospecto",
    req: "Debe haber un prospecto a la cuál definir como cliente.",
  }),
});

export const carrierSchema = Joi.object({
  residence_area: stringValidation("La Zona de residencia"),
  placement_date: dateValidation("fecha de colocación"),
  placement_time: timeValidation,
  electronic_bracelet: stringValidation("El brazalete electrónico"),
  beacon: stringValidation("El BEACON"),
  wireless_charger: stringValidation("El cargador inalámbrico"),
  information_emails: arrValuesValidation("email"),
  ...contact_numbers,
  house_arrest: stringValidation("El arraigo domiciliario"),
  installer_name: stringValidation("El nombre del instalador"),
  observations: Joi.any().optional(), // Permite cualquier tipo de observaciones
  client_id: fieldIdValidation({
    field: "cliente",
    req: "Debe haber un cliente a la cuál definir como portador.",
  }),
  ...relationship_id,
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
    field: "cliente",
    req: "Debe especificar el ID del cliente para la audiencia.",
  }),
  hearing_date: dateValidation("fecha de audiencia"),
  hearing_location: stringValidation("lugar de audiencia"),
  attendees: Joi.array().items(Joi.string().trim()).min(0).required().messages({
    'array.base': 'Los asistentes deben estar en un arreglo',
    'any.required': 'La lista de asistentes es requerida.',
  }),
  notes: Joi.string().optional().allow('', null),
});

export const updateHearingSchema = Joi.object({
  hearing_date: dateValidation("fecha de audiencia").optional(),
  hearing_location: stringValidation("lugar de audiencia").optional(),
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
  uninstall_reason: stringValidation("motivo de desinstalación").optional(),
  uninstall_date: dateValidation("fecha de desinstalación").optional(),
});

export const carrierActSchema = Joi.object({
  act_title: stringValidation("título del acta").max(255),
  act_description: stringValidation("descripción del acta").optional().allow(''),
});

// Schemas para renovaciones de contrato
export const createRenewalSchema = Joi.object({
  client_id: fieldIdValidation({
    field: "cliente",
    req: "Debe especificar el ID del cliente para la renovación.",
  }),
  renewal_date: dateValidation("fecha de renovación"),
  renewal_document: Joi.string().optional().allow('', null),
  renewal_duration: stringValidation("duración de renovación").optional().allow('', null).max(50),
  notes: Joi.string().optional().allow('', null),
});

export const updateRenewalSchema = Joi.object({
  renewal_date: dateValidation("fecha de renovación").optional(),
  renewal_document: Joi.string().optional().allow('', null),
  renewal_duration: stringValidation("duración de renovación").optional().allow('', null).max(50),
  notes: Joi.string().optional().allow('', null),
}).min(1).messages({
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
    field: "cliente",
    req: "Debe especificar el ID del cliente para el oficio.",
  }),
  document_type: stringValidation("tipo de documento").max(100),
  document_number: stringValidation("número de documento").optional().allow('', null).max(50),
  issue_date: dateValidation("fecha de emisión"),
  document_file: Joi.string().optional().allow('', null),
  prosecutor_office: stringValidation("fiscalía emisora").optional().allow('', null).max(200),
  notes: Joi.string().optional().allow('', null),
});

export const updateProsecutorDocSchema = Joi.object({
  document_type: stringValidation("tipo de documento").optional().max(100),
  document_number: stringValidation("número de documento").optional().allow('', null).max(50),
  issue_date: dateValidation("fecha de emisión").optional(),
  document_file: Joi.string().optional().allow('', null),
  prosecutor_office: stringValidation("fiscalía emisora").optional().allow('', null).max(200),
  notes: Joi.string().optional().allow('', null),
}).min(1).messages({
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
// 107
