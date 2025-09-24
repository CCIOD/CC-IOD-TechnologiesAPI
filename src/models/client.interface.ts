// Interfaces para las entidades de clientes y audiencias

export interface IHearing {
  hearing_id?: number;
  client_id: number;
  hearing_date: Date | string;
  hearing_location: string;
  attendees: string[];
  notes?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface IClient {
  client_id?: number;
  contract_number?: string | number;
  contract_folio?: string;
  bracelet_type?: string;
  defendant_name: string;
  criminal_case: string;
  investigation_file_number?: string;
  judge_name: string;
  court_name: string;
  lawyer_name: string;
  signer_name: string;
  placement_date?: Date | string; // Anteriormente hearing_date
  contract_date: Date | string;
  contract_document?: string;
  contract_duration: number;
  payment_day: number;
  payment_frequency?: string;
  status: string;
  prospect_id?: number;
  registered_at?: Date;
  // Relaciones
  hearings?: IHearing[];
  contact_numbers?: IContactNumber[];
  observations?: IObservation[];
}

export interface IContactNumber {
  contact_name: string;
  phone_number: string;
  relationship_id?: number;
  relationship_name?: string;
}

export interface IObservation {
  observation_id?: number;
  client_id: number;
  observation_text: string;
  created_at?: Date;
}

// DTOs para requests de la API
export interface ICreateClientRequest {
  contract_number?: string | number;
  contract_folio?: string;
  bracelet_type?: string;
  defendant_name: string;
  criminal_case: string;
  investigation_file_number?: string;
  judge_name: string;
  court_name: string;
  lawyer_name: string;
  signer_name: string;
  placement_date?: string;
  contract_date: string;
  contract_document?: string;
  contract_duration: number;
  payment_day: number;
  payment_frequency?: string;
  status: string;
  prospect_id?: number;
  contact_numbers: IContactNumber[];
  hearings?: Omit<IHearing, 'hearing_id' | 'client_id' | 'created_at' | 'updated_at'>[];
}

export interface IUpdateClientRequest extends Partial<ICreateClientRequest> {
  client_id: number;
}

export interface ICreateHearingRequest {
  client_id: number;
  hearing_date: string;
  hearing_location: string;
  attendees: string[];
  notes?: string;
}

export interface IUpdateHearingRequest extends Partial<Omit<ICreateHearingRequest, 'client_id'>> {
  hearing_id: number;
}
