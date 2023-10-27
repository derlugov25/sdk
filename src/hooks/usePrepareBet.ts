import { useEffect } from 'react'
import { erc20ABI, useAccount, useContractRead, useContractWrite, useWaitForTransaction } from 'wagmi'
import { parseUnits, formatUnits, encodeAbiParameters, parseAbiParameters } from 'viem'
import { useChain } from '../contexts/chain'
import { DEFAULT_DEADLINE, ODDS_DECIMALS, MAX_UINT_256 } from '../config'
import { usePublicClient } from './usePublicClient'
import { useCalcOdds } from './useCalcOdds'


type Props = {
  amount: string | number
  slippage: number
  deadline?: number
  affiliate: `0x${string}`
  selections: {
    conditionId: string | bigint
    outcomeId: string | number
  }[]
  onSuccess?(): void
  onError?(err: Error | null): void
}

export const usePrepareBet = (props: Props) => {
  const { amount, slippage, deadline, affiliate, selections, onSuccess, onError } = props

  const account = useAccount()
  const publicClient = usePublicClient()
  const { appChain, contracts, betToken } = useChain()

  const allowanceTx = useContractRead({
    chainId: appChain.id,
    address: betToken.address,
    abi: erc20ABI,
    functionName: 'allowance',
    args: [
      account.address!,
      contracts.proxyFront.address,
    ],
    enabled: Boolean(account.address) && !betToken.isNative,
  })

  const approveTx = useContractWrite({
    address: betToken.address,
    abi: erc20ABI,
    functionName: 'approve',
    args: [
      contracts.proxyFront.address,
      MAX_UINT_256,
    ],
  })

  const approveReceipt = useWaitForTransaction(approveTx.data)

  const isApproveRequired = Boolean(
    !betToken.isNative
    && allowanceTx.data !== undefined
    && +amount
    && allowanceTx.data < parseUnits(`${+amount}`, betToken.decimals)
  )

  const approve = async () => {
    const tx = await approveTx.writeAsync()
    await publicClient.waitForTransactionReceipt(tx)
    allowanceTx.refetch()
  }

  const { isLoading: isOddsLoading, data: oddsData } = useCalcOdds({
    selections,
    amount,
  })

  const conditionsOdds = oddsData.conditionsOdds?.map((rawOdds) => {
    return +formatUnits(rawOdds, ODDS_DECIMALS)
  })

  const totalOdds = oddsData.totalOdds ? +formatUnits(oddsData.totalOdds, ODDS_DECIMALS) : undefined

  const betTx = useContractWrite({
    address: contracts.proxyFront.address,
    abi: contracts.proxyFront.abi,
    functionName: 'bet',
    value: BigInt(0),
  })

  const betReceipt = useWaitForTransaction(betTx.data)

  useEffect(() => {
    if (betReceipt.isSuccess && onSuccess) {
      onSuccess()
    }
  }, [ betReceipt.isSuccess ])

  useEffect(() => {
    if (betReceipt.isError && onError) {
      onError(betReceipt.error)
    }
  }, [ betReceipt.isError ])

  const placeBet = async () => {
    if (!totalOdds) {
      return
    }

    const fixedAmount = +parseFloat(String(amount)).toFixed(betToken.decimals)
    const rawAmount = parseUnits(`${fixedAmount}`, betToken.decimals)

    const minOdds = 1 + (totalOdds - 1) * (100 - slippage) / 100
    const fixedMinOdds = +parseFloat(String(minOdds)).toFixed(ODDS_DECIMALS)
    const rawMinOdds = parseUnits(`${fixedMinOdds}`, ODDS_DECIMALS)
    const rawDeadline = BigInt(Math.floor(Date.now() / 1000) + (deadline || DEFAULT_DEADLINE))

    let coreAddress: `0x${string}`
    let data: `0x${string}`

    if (selections.length > 1) {
      coreAddress = contracts.prematchComboCore.address

      const tuple: [ bigint, bigint ][] = selections.map(({ conditionId, outcomeId }) => [
        BigInt(conditionId),
        BigInt(outcomeId),
      ])

      data = encodeAbiParameters(
        parseAbiParameters('(uint256, uint64)[]'),
        [
          tuple,
        ],
      )
    }
    else {
      coreAddress = contracts.prematchCore.address

      const { conditionId, outcomeId } = selections[0]!

      data = encodeAbiParameters(
        parseAbiParameters('uint256, uint64'),
        [
          BigInt(conditionId),
          BigInt(outcomeId),
        ]
      )
    }

    const tx = await betTx.writeAsync({
      args: [
        contracts.lp.address,
        [
          {
            core: coreAddress,
            amount: rawAmount,
            expiresAt: rawDeadline,
            extraData: {
              affiliate,
              minOdds: rawMinOdds,
              data,
            },
          },
        ]
      ],
      value: betToken.isNative ? rawAmount : BigInt(0),
    })

    await publicClient.waitForTransactionReceipt(tx)
  }

  const submit = () => {
    if (isApproveRequired) {
      return approve()
    }

    return placeBet()
  }

  return {
    isAllowanceLoading: allowanceTx.isLoading,
    isApproveRequired,
    isOddsLoading,
    conditionsOdds,
    totalOdds,
    submit,
    approveTx: {
      isPending: approveTx.isLoading,
      isProcessing: approveReceipt.isLoading,
      data: approveTx.data,
      error: approveTx.error,
    },
    betTx: {
      isPending: betTx.isLoading,
      isProcessing: betReceipt.isLoading,
      isSuccess: betReceipt.isSuccess,
      data: betTx.data,
      error: betTx.error,
    },
  }
}