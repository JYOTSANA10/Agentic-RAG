import api from './client';

export interface Ticket {
  id: string;
  ticketRef: string;
  question?: string;
  description?: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  status: 'open' | 'in_progress' | 'resolved';
  createdAt: string;
}

export interface CreateTicketRequest {
  question: string;
  description: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
}

export async function createTicket(data: CreateTicketRequest): Promise<Ticket> {
  const { data: res } = await api.post<{ ticket: Ticket }>('/tickets', data);
  return res.ticket;
}

export async function getMyTickets(): Promise<Ticket[]> {
  const { data: res } = await api.get<{ tickets: Ticket[] }>('/tickets');
  return res.tickets;
}
