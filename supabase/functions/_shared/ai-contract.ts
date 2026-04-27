export interface AiDecisionContext {
  lead: {
    id: string;
    fullName: string | null;
    phone: string | null;
    source: string;
    status: string;
    heat: string;
    score: number;
    ownershipMode: string;
    paymentStatus: string | null;
    doNotContact: boolean;
    removedByRequest: boolean;
    conversationSummary: string | null;
  };
  recentMessages: Array<{
    senderType: string;
    contentText: string | null;
    createdAt: string;
  }>;
  runtimeConfig: {
    activeHours: {
      start: string;
      end: string;
      timezone: string;
    };
    followUpDelays: {
      firstResponseMinutes: number;
      nurtureHours: number;
      paymentPendingHours: number;
    };
  };
}

export interface AiDecisionOutput {
  replyText: string | null;
  intentClassification: string;
  leadStatusUpdate: string | null;
  leadHeatUpdate: string | null;
  scoreDelta: number;
  escalateToMia: boolean;
  escalateToPhoneSales: boolean;
  createQueueType: string | null;
  nextActionType: string | null;
  nextActionDueAt: string | null;
  notesForMia: string | null;
  sendMode: 'freeform' | 'template' | 'manual_only' | 'no_send';
}
