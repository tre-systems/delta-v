import type { Ship } from '../../../types';

export interface PassengerCombatPlanAction {
  type: 'skipCombat';
  carrierShipId: string;
  landingTurns: number | null;
  reason: 'preserveLandingLine' | 'avoidAttritionFinish';
}

export interface PostCarrierLossPursuitAction {
  type: 'astrogationOrder';
  shipId: Ship['id'];
  targetShipId: Ship['id'];
  interceptHex: { q: number; r: number };
  burn: number;
  overload: null;
}

export interface PassengerFuelSupportAction {
  type: 'astrogationOrder';
  shipId: Ship['id'];
  carrierShipId: Ship['id'];
  burn: number | null;
  overload: null;
}

export interface PassengerEscortFormationAction {
  type: 'astrogationOrder';
  shipId: Ship['id'];
  carrierShipId: Ship['id'];
  targetHex: { q: number; r: number };
  burn: number;
  overload: null;
}

export interface PassengerDeliveryApproachAction {
  type: 'astrogationOrder';
  shipId: Ship['id'];
  targetHex: { q: number; r: number };
  burn: number;
  overload: null;
}

export interface PassengerCarrierEscortTargetAction {
  type: 'navigationTargetOverride';
  shipId: Ship['id'];
  carrierShipId: Ship['id'];
  threatShipId: Ship['id'];
  targetHex: { q: number; r: number } | null;
  targetBody: '';
}

export interface PassengerPostCarrierLossTargetAction {
  type: 'navigationTargetOverride';
  shipId: Ship['id'];
  targetHex: null;
  targetBody: '';
}

export interface PassengerCarrierInterceptAction {
  type: 'astrogationOrder';
  shipId: Ship['id'];
  targetShipId: Ship['id'];
  interceptHex: { q: number; r: number };
  burn: number;
  overload: null;
}
