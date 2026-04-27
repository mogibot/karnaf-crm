interface LeadActionsProps {
  leadId: string | null;
  onAssignToMia: () => void;
  onReturnToAi: () => void;
  onMarkPhoneEscalation: () => void;
  onMarkDnc: () => void;
}

export function LeadActions({
  leadId,
  onAssignToMia,
  onReturnToAi,
  onMarkPhoneEscalation,
  onMarkDnc,
}: LeadActionsProps) {
  if (!leadId) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
      <button type="button" onClick={onAssignToMia}>העבר למיה</button>
      <button type="button" onClick={onReturnToAi}>החזר ל-AI</button>
      <button type="button" onClick={onMarkPhoneEscalation}>סמן לשיחה</button>
      <button type="button" onClick={onMarkDnc}>סמן DNC</button>
    </div>
  );
}
