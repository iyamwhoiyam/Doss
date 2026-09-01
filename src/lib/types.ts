/** Record shapes returned by the API. Kept close to the server schema. */

export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  deletedAt: string | null;
}

export interface User extends BaseRecord {
  email: string;
  name: string;
  initials: string;
  role: string;
  title: string;
  department: string;
  phone: string;
  active: boolean;
  accentColor: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  preferences: { theme?: 'dark' | 'light'; density?: 'comfortable' | 'compact'; sidebarCollapsed?: boolean };
}

export interface Contact { name: string; title?: string; email?: string; phone?: string; primary?: boolean }
export interface Address { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string }

export interface Customer extends BaseRecord {
  code: string; name: string; status: string; tier: string; industry: string; website: string;
  ownerId: string; paymentTerms: string; creditLimit: number;
  billingAddress: Address; shippingAddress: Address; contacts: Contact[];
  logoTint: string; notes: string; tags: string[];
}

export interface Vendor extends BaseRecord {
  code: string; name: string; status: string; category: string; website: string;
  contacts: Contact[]; address: Address; leadTimeDays: number; paymentTerms: string; minimumOrder: number;
  qualification: { auditedAt?: string | null; expiresAt?: string | null; certifications?: string[]; questionnaireOnFile?: boolean };
  rating: { quality?: number; delivery?: number; responsiveness?: number };
  buyerId: string; notes: string; tags: string[];
}

export interface Item extends BaseRecord {
  itemCode: string; name: string; type: string; category: string; form: string; uom: string;
  costPerUom: number; pricePerKg: number; priceSource: string;
  reorderPoint: number; reorderQty: number; safetyStock: number; leadTimeDays: number;
  defaultVendorId: string; defaultLocationId: string; shelfLifeDays: number; storageConditions: string;
  allergens: string[]; isBranded: boolean; brandOwner: string; labelName: string;
  requiresCoa: boolean; active: boolean; notes: string; tags: string[];
}

export interface InventoryAlert { kind: string; severity: 'danger' | 'warning' | 'info'; message: string; suggestion: string }

export interface ItemPosition extends Item {
  onHand: number; released: number; quarantined: number; onHold: number; onOrder: number;
  lotCount: number; value: number; nextExpiry: string | null; alerts: InventoryAlert[];
}

export interface Lot extends BaseRecord {
  lotNumber: string; itemId: string; vendorId: string; vendorLot: string;
  purchaseOrderId: string; workOrderId: string; status: string;
  qtyReceived: number; qtyOnHand: number; uom: string; locationId: string; unitCost: number;
  receivedAt: string | null; manufacturedAt: string | null; expiresAt: string | null; retestAt: string | null;
  coaDocumentId: string; coaReceived: boolean;
  testResults: { test: string; method?: string; spec?: string; result?: string; pass?: boolean }[];
  dispositionBy: string; dispositionAt: string | null; notes: string;
}

export interface Location extends BaseRecord {
  code: string; name: string; type: string; parentId: string;
  temperatureControlled: boolean; capacity: number; active: boolean; notes: string;
}

export interface InventoryTxn extends BaseRecord {
  txnNumber: string; type: string; itemId: string; lotId: string; qty: number; uom: string;
  fromLocationId: string; toLocationId: string; refType: string; refId: string;
  reason: string; unitCost: number; balanceAfter: number; performedAt: string | null;
}

export interface PurchaseOrderLine {
  itemId: string; itemCode?: string; description: string; qty: number; uom: string;
  unitCost: number; received: number; expectedDate: string | null; lotIds: string[];
}

export interface PurchaseOrder extends BaseRecord {
  poNumber: string; vendorId: string; status: string; buyerId: string;
  lines: PurchaseOrderLine[]; subtotal: number; freight: number; tax: number; total: number; currency: string;
  orderedAt: string | null; expectedAt: string | null; receivedAt: string | null;
  approvedBy: string; approvedAt: string | null; terms: string; shipTo: string; notes: string;
}

export interface SalesOrderLine {
  formulaId: string; description: string; qty: number; uom: string; unitPrice: number; shipped: number;
}

export interface SalesOrder extends BaseRecord {
  orderNumber: string; customerId: string; status: string; priority: string; customerPo: string;
  quoteId: string; ownerId: string; lines: SalesOrderLine[];
  subtotal: number; freight: number; total: number;
  requestedShipDate: string | null; promisedShipDate: string | null; shippedAt: string | null;
  notes: string; tags: string[];
}

export interface Shipment extends BaseRecord {
  shipmentNumber: string; salesOrderId: string; customerId: string; status: string;
  carrier: string; service: string; trackingNumber: string; cartons: number; weightLb: number; cost: number;
  lines: { description: string; qty: number }[]; shippedAt: string | null; deliveredAt: string | null; notes: string;
}

export interface DocumentVersion {
  version: number; filename: string; fileId: string; size: number; mime: string;
  uploadedBy: string; uploadedAt: string; notes: string; placeholder?: boolean;
}

export interface Doc extends BaseRecord {
  name: string; category: string; status: string; ownerType: string; ownerId: string;
  customerId: string; vendorId: string; currentVersion: number; versions: DocumentVersion[];
  effectiveDate: string | null; expiresAt: string | null;
  reviewerId: string; approvedBy: string; approvedAt: string | null;
  confidential: boolean; description: string; tags: string[];
  ownerName?: string; latest?: DocumentVersion | null; daysUntilExpiry?: number | null;
}

export interface Milestone { name: string; due: string | null; done: boolean; doneAt: string | null }
export interface GateCheck { gate: string; label: string; passed: boolean; by?: string }
export interface Requirement { label: string; met: boolean }
export interface Risk { label: string; severity: string; owner?: string }

export interface Project extends BaseRecord {
  code: string; name: string; customerId: string; stage: string; type: string;
  priority: string; health: string; ownerId: string; teamIds: string[];
  formulaId: string; quoteId: string; format: string; targetLaunch: string | null;
  brief: string; requirements: Requirement[]; milestones: Milestone[];
  gateChecks: GateCheck[]; risks: Risk[]; progress: number;
  boardOrder: number; stageEnteredAt: string | null; tags: string[]; notes: string;
  lockState?: 'open' | 'pending_approval' | 'locked';
  productRevision?: number;
  approval?: ProductApproval;
  approvalHistory?: ProductApproval[];
  approvalToken?: string;
  approvalRequestedAt?: string | null;
}

export interface Rfq extends BaseRecord {
  rfqNumber: string; status: string; productName: string;
  customerId: string; customerName: string; contactName: string; contactEmail: string;
  source: string; format: string; servingSize: string; desiredActives: string;
  targetQty: number; targetPrice: number; priority: string; dueDate: string | null;
  ownerId: string; projectId: string; formulaId: string; quoteId: string;
  outcome: string; lostReason: string; boardOrder: number; stageEnteredAt: string | null;
  notes: string; tags: string[];
}

export interface Sample extends BaseRecord {
  sampleNumber: string; type: string; status: string; productName: string;
  projectId: string; customerId: string; formulaId: string;
  lotId: string; lotNumber: string; quantity: number; uom: string;
  recipientName: string; recipientCompany: string; shipTo: string;
  carrier: string; trackingNumber: string; requestedById: string; ownerId: string;
  requestedAt: string | null; shippedAt: string | null; deliveredAt: string | null;
  dueBy: string | null; respondedAt: string | null; outcome: string; feedback: string;
  boardOrder: number; stageEnteredAt: string | null; notes: string; tags: string[];
}

export interface ProductApproval {
  decision: string; method: string; signedName: string; signedTitle?: string;
  note?: string; evidenceDocId?: string; byUserId?: string; byName?: string;
  at: string; revision: number;
}

export interface IngredientLine {
  itemId: string | null; code: string; name: string; form?: string;
  targetMg?: number | null; inputMg?: number | null; isBaseFill?: boolean;
  pricePerKg: number; priceSource: string;
  labelClaim?: number | null; labelUnit?: string | null; brandOwner?: string;
}

export interface PackagingLine { itemId: string | null; code: string; name: string; costPerUnit: number; priceSource: string }
export interface ServiceLine { name: string; costPerUnit: number; basis?: string }

export interface Formula extends BaseRecord {
  code: string; name: string; revision: number; status: string; supersedesId: string;
  customerId: string; projectId: string; format: string; isBulk: boolean;
  servingSize: string; servingsPerUnit: number; unitsPerBatch: number;
  totalFormatWeightMg: number; capsuleShellSize: string; overagePct: number;
  actives: IngredientLine[]; excipients: IngredientLine[];
  packaging: PackagingLine[]; services: ServiceLine[];
  allergens: string[]; claims: string[];
  ownerId: string; approvedBy: string; approvedAt: string | null; notes: string; tags: string[];
}

export interface TierLabor {
  blendingPer1000?: number; fillPer1000?: number; encapsulationPer1000?: number;
  depositPer1000?: number; compressionPer1000?: number; packagingPer1000?: number;
  qcPctOfProduction?: number;
}

export interface QuoteTierInput { qty: number; labor: TierLabor; overheadRate: number; margin: number | null }

export interface ComplianceFlag {
  check: string; status: 'PASS' | 'WARN' | 'BLOCK'; detail: string; authority?: string;
}

export interface CostedLine {
  code: string; itemId: string | null; name: string; form: string;
  targetMg: string; inputMg: string; labelClaim: number | null; labelUnit: string | null;
  pricePerKg: string; pricePerMg: string; priceSource: string;
  costPerServing: string; costPerUnit: string; isBaseFill: boolean;
}

export interface CostedTier {
  qty: number;
  laborLines: { label: string; ratePer1000: string; perUnit: string }[];
  laborPerUnit: string; overheadRate: number; overheadPerUnit: string; coaPerUnit: string;
  rawMaterialsPerUnit: string; packagingPerUnit: string; servicesPerUnit: string;
  cogsPerUnit: string; margin: number | null;
  salePricePerUnit: string | null; extendedTotal: string | null; marginDollars: string | null;
  batchCogs: string;
}

export interface QuoteResult {
  meta: Record<string, unknown> & { generatedAt: string; coaFee: string; leadTimeWeeks: number; paymentTerms: string };
  product: {
    format: string; isBulk: boolean; servingSize: string; servingsPerUnit: number;
    totalFormatWeightMg: string; totalInputMg: string; capsuleShellSize: string | null;
    overagePct: number; fillUtilisationPct: string; unitsPerServing: number; perPieceWeightMg: string;
  };
  ingredients: { actives: CostedLine[]; excipients: CostedLine[] };
  packaging: { code: string; itemId: string | null; name: string; costPerUnit: string; priceSource: string }[];
  services: { name: string; costPerUnit: string; basis: string }[];
  costSummary: { rawMaterialsPerUnit: string; packagingPerUnit: string; servicesPerUnit: string; coaFee: string };
  compliance: ComplianceFlag[];
  complianceWorst: 'PASS' | 'WARN' | 'BLOCK';
  tiers: CostedTier[];
}

export interface Quote extends BaseRecord {
  quoteNumber: string; title: string; customerId: string; formulaId: string; projectId: string;
  status: string; revision: number; ownerId: string; coaFee: number;
  tiers: QuoteTierInput[]; snapshot: Record<string, unknown>; result: QuoteResult;
  leadTimeWeeks: number; paymentTerms: string; validUntil: string | null;
  sentAt: string | null; decidedAt: string | null; notes: string; tags: string[];
}

export interface WorkOrderMaterial {
  itemId: string; itemCode: string; name: string; lotId: string; lotNumber: string;
  plannedQty: number; issuedQty: number; uom: string; issuedAt: string | null; issuedBy: string;
}

export interface BatchStep {
  name: string; done: boolean; doneBy: string; doneAt: string | null;
  requiresSignature: boolean; notes: string;
}

export interface QcCheck {
  name: string; spec: string; result: string; status: string; checkedBy: string; checkedAt: string | null;
}

export interface Deviation {
  id: string; raisedBy: string; raisedAt: string; summary: string;
  status: string; disposition: string; closedBy?: string; closedAt?: string | null;
}

export interface WorkOrder extends BaseRecord {
  woNumber: string; batchNumber: string; stage: string; priority: string;
  productName: string; formulaId: string; customerId: string; salesOrderId: string; line: string;
  plannedQty: number; actualQty: number; uom: string;
  plannedStart: string | null; plannedEnd: string | null; actualStart: string | null; actualEnd: string | null;
  supervisorId: string; operatorIds: string[];
  materials: WorkOrderMaterial[]; steps: BatchStep[]; qcChecks: QcCheck[]; deviations: Deviation[];
  standardUnitCost?: number; standardMaterialCost?: number;
  actualUnitCost?: number; actualMaterialCost?: number; outputLotId?: string;
  yieldPct: number; holdReason: string; boardOrder: number; stageEnteredAt: string | null;
  releasedBy: string; releasedAt: string | null; notes: string; tags: string[];
}

export interface ChecklistRow {
  id: number; row: number; cat: string; text: string; needs: 'copy' | 'art' | 'file';
  look: string; state: string; comment: string; decidedBy?: string; decidedAt?: string | null;
}

export interface Finding {
  id: string; rowId: number; type: 'required' | 'recommendation';
  issue: string; authority: string; proposedWording: string; evidence: string;
  decision: 'pending' | 'accepted' | 'denied'; note?: string;
  decidedBy: string | null; decidedAt: string | null;
}

export interface SupplementFactsRow {
  name: string; display: string; amount: number; unit: string;
  iuEquivalent: number | null; pctDv: number | null; footnote: boolean; hasDv: boolean;
}

export interface SupplementFacts {
  servingSize: string; servingsPerContainer: number | null;
  rows: SupplementFactsRow[]; otherIngredients: string[]; footnotes: string[];
  dvBasis?: string; generatedAt?: string;
}

export interface LabelMetrics {
  total: number; pass: number; fail: number; na: number; notReviewed: number;
  reviewed: number; completionPct: number; requiredCorrections: number; recommendations: number;
}

export interface LabelPanels { pdp?: string; information?: string; leftSide?: string; rightSide?: string; other?: string }

export interface LabelReview extends BaseRecord {
  reviewNumber: string; productName: string; brand: string;
  customerId: string; projectId: string; formulaId: string;
  status: string; labelRevision: string; source: string; receivedAt: string | null;
  panels: LabelPanels; checklist: ChecklistRow[]; findings: Finding[];
  supplementFacts: SupplementFacts | Record<string, never>; metrics: LabelMetrics;
  reviewerId: string; reviewedAt: string | null; approverId: string; approvedAt: string | null;
  documentIds: string[]; notes: string; tags: string[];
}

export interface Task extends BaseRecord {
  title: string; description: string; status: string; priority: string;
  assigneeId: string; dueDate: string | null; refType: string; refId: string; refLabel: string;
  boardOrder: number; completedAt: string | null; tags: string[];
}

export interface Activity extends BaseRecord {
  type: string; title: string; detail: string; actorId: string; actorName: string;
  refType: string; refId: string; link: string; tone: string;
}

export interface Notification extends BaseRecord {
  userId: string; title: string; body: string; link: string;
  severity: string; read: boolean; readAt: string | null;
}

export interface CycleCount extends BaseRecord {
  countNumber: string; locationId: string; status: string; scheduledFor: string | null;
  lines: { lotId: string; lotNumber: string; itemId: string; expectedQty: number; countedQty: number | null; variance: number | null; countedBy: string }[];
  countedBy: string; closedBy: string; closedAt: string | null; notes: string;
}

export interface Setting extends BaseRecord {
  key: string; value: unknown; label: string; category: string; description: string;
}

export interface PresenceUser {
  id: string; name: string; initials: string; role: string;
  accentColor: string; viewing: string | null; since: string; connections: number;
}

export interface Kpi {
  key: string; label: string; value: string | number; detail: string; tone: string; link: string;
}

export interface DashboardAlert { severity: string; module: string; title: string; detail: string; link: string }

export interface Dashboard {
  generatedAt: string;
  kpis: Kpi[];
  production: { value: string; label: string; tone: string; count: number; units: number; wipLimit?: number }[];
  pipeline: { value: string; label: string; tone: string; count: number }[];
  alerts: DashboardAlert[];
  myWork: {
    tasks: Task[]; workOrders: WorkOrder[]; projects: Project[];
    quotes: Quote[]; labelReviews: LabelReview[]; notifications: Notification[];
  };
  activity: Activity[];
  schedule: {
    id: string; woNumber: string; productName: string; stage: string; line: string;
    plannedStart: string | null; plannedEnd: string | null; plannedQty: number;
    priority: string; customerName: string;
  }[];
  throughput: { weekOf: string; batches: number; units: number }[];
}
