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
  hearing_date: dateValidation("fecha de audiencia"),
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
    ],
    field: "estado",
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
  ...email,
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
// 107
