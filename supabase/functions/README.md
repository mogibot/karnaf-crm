# supabase/functions

Suggested first function set:
- `whatsapp-webhook` - receives inbound provider payloads and normalizes them
- `orchestrate-message` - loads context, invokes the AI decision engine, writes CRM updates
- `payment-webhook` - ingests payment completion events and moves leads toward `won`
- `provider-status-webhook` - handles delivery/read/failure callbacks from the messaging provider
- `admin-actions` - protected operator actions for ownership, DNC, and escalation changes
