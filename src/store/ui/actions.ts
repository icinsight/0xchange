import { BigNumber, MetamaskSubprovider, signatureUtils } from '0x.js';
import { createAction } from 'typesafe-actions';

import { getContractWrappers } from '../../services/contract_wrappers';
import { getWeb3WrapperOrThrow } from '../../services/web3_wrapper';
import { isWeth, isZrx } from '../../util/known_tokens';
import { buildLimitOrder, buildMarketOrders } from '../../util/orders';
import {
    Notification,
    NotificationKind,
    OrderSide,
    Step,
    StepKind,
    StepUnlockToken,
    StepWrapEth,
    StoreState,
    Token,
    TokenBalance,
} from '../../util/types';
import * as selectors from '../selectors';

export const setHasUnreadNotifications = createAction('SET_HAS_UNREAD_NOTIFICATIONS', resolve => {
    return (hasUnreadNotifications: boolean) => resolve(hasUnreadNotifications);
});

export const addNotification = createAction('ADD_NOTIFICATION', resolve => {
    return (newNotification: Notification) => resolve(newNotification);
});

export const setNotifications = createAction('SET_NOTIFICATIONS', resolve => {
    return (notifications: Notification[]) => resolve(notifications);
});

export const setStepsModalPendingSteps = createAction('SET_STEPSMODAL_PENDING_STEPS', resolve => {
    return (pendingSteps: Step[]) => resolve(pendingSteps);
});

export const setStepsModalDoneSteps = createAction('SET_STEPSMODAL_DONE_STEPS', resolve => {
    return (doneSteps: Step[]) => resolve(doneSteps);
});

export const setStepsModalCurrentStep = createAction('SET_STEPSMODAL_CURRENT_STEP', resolve => {
    return (currentStep: Step | null) => resolve(currentStep);
});

export const stepsModalAdvanceStep = createAction('STEPSMODAL_ADVANCE_STEP');

export const stepsModalReset = createAction('STEPSMODAL_RESET');

export const startBuySellLimitSteps = (amount: BigNumber, price: BigNumber, side: OrderSide) => {
    return async (dispatch: any, getState: any) => {
        const state = getState();
        const baseToken = selectors.getBaseToken(state) as Token;
        const quoteToken = selectors.getQuoteToken(state) as Token;

        const buySellLimitFlow: Step[] = [];

        // unlock base and quote tokens if necessary
        const unlockBaseTokenStep = getUnlockTokenStepIfNeeded(baseToken, state);
        if (unlockBaseTokenStep) {
            buySellLimitFlow.push(unlockBaseTokenStep);
        }

        const unlockQuoteTokenStep = getUnlockTokenStepIfNeeded(quoteToken, state);
        if (unlockQuoteTokenStep) {
            buySellLimitFlow.push(unlockQuoteTokenStep);
        }

        // unlock zrx (for fees) if it's not one of the traded tokens
        if (!isZrx(baseToken) && !isZrx(quoteToken)) {
            const unlockZrxStep = getUnlockZrxStepIfNeeded(state);
            if (unlockZrxStep) {
                buySellLimitFlow.push(unlockZrxStep);
            }
        }

        // wrap the necessary ether if it is one of the traded tokens
        if (isWeth(baseToken) || isWeth(quoteToken)) {
            const wrapEthStep = getWrapEthStepIfNeeded(amount, price, side, state);
            if (wrapEthStep) {
                buySellLimitFlow.push(wrapEthStep);
            }
        }

        buySellLimitFlow.push({
            kind: StepKind.BuySellLimit,
            amount,
            price,
            side,
        });

        dispatch(setStepsModalCurrentStep(buySellLimitFlow[0]));
        dispatch(setStepsModalPendingSteps(buySellLimitFlow.slice(1)));
        dispatch(setStepsModalDoneSteps([]));
    };
};

export const startBuySellMarketSteps = (amount: BigNumber, side: OrderSide) => {
    return async (dispatch: any, getState: any) => {
        const state = getState();
        const baseToken = selectors.getBaseToken(state) as Token;
        const quoteToken = selectors.getQuoteToken(state) as Token;

        const orders = side === OrderSide.Buy ? selectors.getOpenSellOrders(state) : selectors.getOpenBuyOrders(state);
        const [, , canBeFilled] = buildMarketOrders(
            {
                amount,
                orders,
            },
            side,
        );
        if (!canBeFilled) {
            window.alert('There are no enough orders to fill this amount');
            return;
        }

        const buySellMarketFlow: Step[] = [];

        const tokenToUnlock = side === OrderSide.Buy ? quoteToken : baseToken;
        const unlockTokenStep = getUnlockTokenStepIfNeeded(tokenToUnlock, state);
        if (unlockTokenStep) {
            buySellMarketFlow.push(unlockTokenStep);
        }

        if (!isZrx(tokenToUnlock)) {
            const unlockZrxStep = getUnlockZrxStepIfNeeded(state);
            if (unlockZrxStep) {
                buySellMarketFlow.push(unlockZrxStep);
            }
        }

        // todo: wrap ether if necessary

        buySellMarketFlow.push({
            kind: StepKind.BuySellMarket,
            amount,
            side,
            token: tokenToUnlock,
        });

        dispatch(setStepsModalCurrentStep(buySellMarketFlow[0]));
        dispatch(setStepsModalPendingSteps(buySellMarketFlow.slice(1)));
        dispatch(setStepsModalDoneSteps([]));
    };
};

const getWrapEthStepIfNeeded = (
    amount: BigNumber,
    price: BigNumber,
    side: OrderSide,
    state: StoreState,
): StepWrapEth | null => {
    // Weth needed only when creating a buy order
    if (side === OrderSide.Sell) {
        return null;
    }

    const wethAmount = amount.mul(price);
    const wethBalance = selectors.getWethBalance(state);
    const deltaWeth = wethBalance.sub(wethAmount);
    // Need to wrap eth only if weth balance is not enough
    if (deltaWeth.lessThan(0)) {
        return {
            kind: StepKind.WrapEth,
            amount: deltaWeth.abs(),
        };
    } else {
        return null;
    }
};

const getUnlockZrxStepIfNeeded = (state: StoreState): StepUnlockToken | null => {
    const tokenBalances = selectors.getTokenBalances(state);
    const zrxTokenBalance: TokenBalance = tokenBalances.find(tokenBalance => isZrx(tokenBalance.token)) as TokenBalance;
    if (zrxTokenBalance.isUnlocked) {
        return null;
    } else {
        return {
            kind: StepKind.UnlockToken,
            token: zrxTokenBalance.token,
        };
    }
};

const getUnlockTokenStepIfNeeded = (token: Token, state: StoreState): StepUnlockToken | null => {
    const tokenBalances = selectors.getTokenBalances(state);

    let tokenBalance: TokenBalance;
    if (isWeth(token)) {
        tokenBalance = selectors.getWethTokenBalance(state) as TokenBalance;
    } else {
        tokenBalance = tokenBalances.find(
            tb => tb.token.symbol.toLowerCase() === token.symbol.toLowerCase(),
        ) as TokenBalance;
    }

    if (tokenBalance.isUnlocked) {
        return null;
    } else {
        return {
            kind: StepKind.UnlockToken,
            token: tokenBalance.token,
        };
    }
};

export const createSignedOrder = (amount: BigNumber, price: BigNumber, side: OrderSide) => {
    return async (dispatch: any, getState: any) => {
        const state = getState();
        const ethAccount = selectors.getEthAccount(state);
        const baseToken = selectors.getBaseToken(state) as Token;
        const quoteToken = selectors.getQuoteToken(state) as Token;

        const web3Wrapper = await getWeb3WrapperOrThrow();
        const contractWrappers = await getContractWrappers();

        const order = buildLimitOrder(
            {
                account: ethAccount,
                amount,
                price,
                baseTokenAddress: baseToken.address,
                quoteTokenAddress: quoteToken.address,
                exchangeAddress: contractWrappers.exchange.address,
            },
            side,
        );

        const provider = new MetamaskSubprovider(web3Wrapper.getProvider());
        return signatureUtils.ecSignOrderAsync(provider, order, ethAccount);
    };
};

export const addMarketBuySellNotification = (amount: BigNumber, token: Token, side: OrderSide, tx: Promise<any>) => {
    return async (dispatch: any) => {
        dispatch(
            addNotification({
                kind: NotificationKind.Market,
                amount,
                token,
                side,
                tx,
                timestamp: new Date(),
            }),
        );
    };
};