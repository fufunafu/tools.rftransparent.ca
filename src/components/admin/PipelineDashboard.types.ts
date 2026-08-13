export interface MonthlyTrend {
  month: string;
  draftsCreated: number;
  draftsConverted: number;
  conversionRate: number;
  pipelineValue: number;
  revenue: number;
}

export interface PipelineMetrics {
  totalQuotedValue: number;
  wonRevenue: number;
  conversionRate: number;
  valueWinRate: number;
  avgCycleTimeDays: number;
  pipelineValue: number;
  avgSaleValue: number;
  totalDrafts: number;
  completedDrafts: number;
  openDrafts: number;
  invoiceSentDrafts: number;
  predictedRevenue: number;
  predictedTimelineDays: number;
  monthlyTrend: MonthlyTrend[];
}

export interface RepEntry {
  repTag: string;
  repName: string;
  totalDrafts: number;
  completedDrafts: number;
  openDrafts: number;
  conversionRate: number;
  totalQuoted: number;
  wonRevenue: number;
  avgCycleTimeDays: number | null;
  avgSaleValue: number;
  pipelineValue: number;
}

export interface StoreOption {
  id: string;
  label: string;
}

export interface AgeBucket {
  label: string;
  drafts: number;
  value: number;
  conversionRate: number;
  predictedValue: number;
}

export interface MonthlyForecast {
  month: string;
  monthLabel: string;
  forecast: number;
  prevMonthRevenue: number;
  momRate: number;
  momRateCapped: boolean;
  fromPipeline: number;
  isFallback: boolean;
}

export interface SeasonalMonth {
  month: string;
  monthLabel: string;
  revenue: number;
  momGrowth: number | null;
}

export interface PipelinePrediction {
  totalPipelineValue: number;
  totalPredictedRevenue: number;
  avgMonthlyRevenue: number;
  avgCycleTimeDays: number;
  startingMonth: string;
  startingRevenue: number;
  monthlyForecasts: MonthlyForecast[];
  annualForecast: number;
  fallbackMomRates: Record<number, number>;
  buckets: AgeBucket[];
  seasonalPattern: SeasonalMonth[];
}

export interface ChannelMonthlyTrend {
  month: string;
  draftOrders: number;
  draftRevenue: number;
  directOrders: number;
  directRevenue: number;
  draftRevenueShare: number;
}

export interface RepChannelEntry {
  repTag: string;
  repName: string;
  orders: number;
  revenue: number;
  aov: number;
}

export interface OrderChannelMetrics {
  totalOrders: number;
  totalRevenue: number;
  draftOrders: number;
  draftRevenue: number;
  draftAOV: number;
  directOrders: number;
  directRevenue: number;
  directAOV: number;
  draftRevenueShare: number;
  employeeBreakdown: RepChannelEntry[];
  monthlyTrend: ChannelMonthlyTrend[];
}

export interface PipelineData {
  metrics: PipelineMetrics;
  prediction: PipelinePrediction;
  channelMetrics: OrderChannelMetrics;
  leaderboard: RepEntry[];
  stores: StoreOption[];
  period: { from: string; to: string; days: number };
  cachedAt?: string;
}

export type SortKey =
  | "repName"
  | "totalDrafts"
  | "completedDrafts"
  | "conversionRate"
  | "pipelineValue"
  | "wonRevenue"
  | "avgSaleValue"
  | "avgCycleTimeDays";
