import { useNetwork } from 'wagmi'
import { chainsData } from '../config'

export const useChainData = () => {
  const { chain } = useNetwork()

  const chainData = chain?.id ? chainsData[chain.id] : undefined

  if (!chainData) {
    console.error(`Selected network not supported.`)
    return
  }

  return chainData
}