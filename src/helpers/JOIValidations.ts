import JoiBase from 'joi';
import JoiDate from '@joi/date';
const Joi = JoiBase.extend(JoiDate);

type Params = {
  allowedValues?: number[] | string[];
  allowedMsg?: string;
  req?: string;
  field: string;
};

const numberPositiveJOI = Joi.number().integer().positive();

export const emailValidation = Joi.string().email().required().messages({
  'any.required': 'El correo es obligatorio',
  'string.empty': 'El correo no puede estar vacío',
  'string.email': 'El correo electrónico no es válido',
});
export const phoneValidation = Joi.string()
  .length(10)
  .regex(/^\d{10}$/)
  .required()
  .messages({
    'string.length': 'El teléfono debe contener exactamente 10 dígitos.',
    'any.required': 'El teléfono es obligatorio',
    'string.empty': 'El teléfono no puede estar vacío',
    'string.base': 'El teléfono debe introducirse en formato texto',
    'string.pattern.base': 'El teléfono solo debe contener dígitos numéricos',
  });
export const timeValidation = Joi.string()
  .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
  .required()
  .messages({
    'string.empty': 'La hora de colocación no puede estar vacía.',
    'string.pattern.base': 'La hora de colocación debe estar en formato HH:mm (24 horas).',
    'any.required': 'La hora de colocación es obligatorio.',
  });

export const fieldIdValidation = ({ allowedValues, allowedMsg, req, field }: Params) => {
  const JOI = allowedValues ? numberPositiveJOI.valid(...allowedValues) : numberPositiveJOI.required();
  const onlyMsg = allowedValues ? (allowedMsg ? `El ${field} debe ser ${allowedMsg}` : 'La opción seleccionada no está disponible.') : '';
  return JOI.messages({
    'any.required': req ? req : `Debe seleccionar un ${field}`,
    'number.empty': `El ${field} es obligatorio.`,
    'number.base': `El id del ${field} debe ser un número`,
    'number.integer': `El id del ${field} debe ser un número entero`,
    'number.positive': `El id del ${field} debe ser un número positivo`,
    'any.only': onlyMsg,
  });
};
export const statusValidation = ({ allowedValues, field }: Params) => {
  const values = allowedValues;
  const base = Joi.string().required();
  const JOI = values ? base.valid(...values) : base;
  const onlyMsg =
    values?.length === 1
      ? values[0]
      : values?.length === 2
      ? `${values[0]} o ${values[1]}`
      : `${values!.slice(0, -1).join(', ')} o ${values![values!.length - 1]}`;
  return JOI.messages({
    'any.required': `El ${field} es obligatorio`,
    'string.base': `El ${field} debe ser un texto.`,
    'string.empty': `El ${field} no puede estar vacío`,
    'any.only': `El ${field} debe ser ${onlyMsg}.`,
  });
};
export const stringValidation = (str: string = 'El nombre') => {
  return Joi.string()
    .required()
    .messages({
      'any.required': `${str} es obligatorio`,
      'string.empty': `${str} no puede estar vacío`,
      'string.base': `${str} debe ser una cadena.`,
    });
};
export const dateValidation = (date: string = 'fecha') => {
  return Joi.date()
    .iso()
    .required()
    .messages({
      'any.required': `La ${date} es obligatorio`,
      'date.base': `La ${date} debe ser una fecha válida.`,
      'date.isoDate': `El formato de la ${date} debe ser válido (YYYY-MM-DD o ISO 8601).`,
    });
};
export const numberPositiveValidation = (number: string = 'número', isNull: boolean = false) => {
  const JOI = isNull ? numberPositiveJOI.allow(null).optional() : numberPositiveJOI.required();

  let messages = {
    'number.empty': `El ${number} no puede estar vacío`,
    'number.base': `El ${number} debe ser un número`,
    'number.integer': `El ${number} debe ser un número entero.`,
    'number.positive': `El ${number} debe ser un número positivo.`,
  };

  if (!isNull) {
    const reqMsg = { 'any.required': `El ${number} es obligatorio` };
    messages = { ...messages, ...reqMsg };
  }
  return JOI.messages(messages);
};
export const arrValuesValidation = (type: 'contacto' | 'email') => {
  const validation = type === 'contacto' ? phoneValidation : emailValidation;
  const base = type === 'contacto' ? 'números de contacto' : 'correos para información';
  return Joi.array()
    .items(validation)
    .min(1)
    .required()
    .messages({
      'array.base': `Los ${base} deben estar en un arreglo`,
      'any.required': `Los ${base} son requeridos.`,
    });
};
export const observationsValidation = {
  observations: Joi.string().max(4000).allow('').optional().messages({
    'string.max': 'La observación no puede exceder los 4000 caracteres.',
  }),
};

export const roleIdValidation = {
  role_id: Joi.number().valid(2, 3).integer().optional().messages({
    'number.base': 'El rol debe ser un número.',
    'any.only': 'El rol debe ser Director o Administrativo',
    'number.integer': 'El rol debe ser un número entero.',
  }),
};

export const passwordValidation = {
  password: Joi.string()
    .regex(/^(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])(?=.*\W)(?!.* ).{8,}$/)
    .required()
    .messages({
      'any.required': 'La contraseña es obligatoria',
      'string.empty': 'La contraseña no puede estar vacía',
      'string.pattern.base':
        'La contraseña debe contener un dígito del 1 al 9, una letra minúscula, una letra mayúscula, un carácter especial, sin espacios y debe tener mínimo 8 caracteres.',
    }),
};

// Validaciones adicionales para clientes
export const contractNumberValidation = Joi.string()
  .required()
  .messages({
    'string.base': 'El número de contrato debe ser texto',
    'string.empty': 'El número de contrato no puede estar vacío',
    'any.required': 'El número de contrato es obligatorio',
  });

export const contactWithDetailsValidation = Joi.array()
  .items(
    Joi.object({
      phone: phoneValidation,
      name: stringValidation("nombre del contacto"),
      relationship_id: fieldIdValidation({
        field: "parentesco",
        allowedValues: [1, 2],
        allowedMsg: "Familiar o Abogado",
      }),
    })
  )
  .min(1)
  .required()
  .messages({
    'array.base': 'Los contactos deben estar en un arreglo',
    'any.required': 'Los contactos son requeridos.',
    'array.min': 'Debe haber al menos un contacto.',
  });

export const contractDurationValidation = Joi.number()
  .integer()
  .positive()
  .max(60)
  .required()
  .messages({
    'number.base': 'La duración del contrato debe ser un número',
    'number.integer': 'La duración del contrato debe ser un número entero',
    'number.positive': 'La duración del contrato debe ser positiva',
    'number.max': 'La duración del contrato no puede exceder 60 meses',
    'any.required': 'La duración del contrato es obligatoria',
  });

export const paymentDayValidation = Joi.number()
  .integer()
  .min(1)
  .max(31)
  .required()
  .messages({
    'number.base': 'El día de pago debe ser un número',
    'number.integer': 'El día de pago debe ser un número entero',
    'number.min': 'El día de pago debe ser entre 1 y 31',
    'number.max': 'El día de pago debe ser entre 1 y 31',
    'any.required': 'El día de pago es obligatorio',
  });

export const paymentFrequencyValidation = Joi.string()
  .valid('Mensual', 'Bimestral', 'Trimestral', 'Semestral', 'Contado')
  .messages({
    'string.base': 'La frecuencia de pago debe ser texto',
    'any.only': 'La frecuencia de pago debe ser: Mensual, Bimestral, Trimestral, Semestral o Contado',
  });
