import { createContext, useContext, useState } from 'react';

export const AppContext = createContext();

export const useAppContext = () => useContext(AppContext);

export const defaultState = {
  aliceNodeId: null,
  bobNodeId: null,
  aliceWalletAddr: null,
  aliceRgbAddr: null,
  bobWalletAddr: null,
  contractId: null,
  assetId: null,
  userChannelId: null,
  channelId: null,
  swapPreimage: null,
  swapPaymentHash: null,
  holdInvoice: null,
  rgbPaymentId: null,
};

export const defaultConfig = {
  aliceDockerIp: '172.18.0.4',
  bobDockerIp: '172.18.0.5',
  aliceP2pPort: 9735,
  issuerName: 'RGB20-Simplest-v0-rLosfg',
};
