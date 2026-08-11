/**
 * The slice of ERC-20 this app uses, as a viem-native const ABI.
 *
 * `as const` is load-bearing, not stylistic: viem derives argument and return
 * types from the literal ABI shape. Without it every readContract returns
 * `unknown` and every writeContract stops type-checking its args, which is
 * exactly the safety net you want on the code path that moves money.
 *
 * Deliberately minimal -- approve/allowance/transferFrom are absent because
 * this app never pulls funds from a user. Deposits are a user-initiated
 * `transfer` to the vault, withdrawals are a vault-initiated `transfer` out.
 * An approval flow would mean users granting the vault spending rights over
 * their wallet, which is a much larger thing to ask and entirely unnecessary
 * for the deposit/withdraw model here.
 */

export const usdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    // The event a deposit receipt is verified against. `from` and `to` are
    // indexed (they are topics), `value` is not (it is in the data field) --
    // that layout has to match the real ERC-20 event exactly or viem's
    // decodeEventLog silently fails to match the log.
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * keccak256("Transfer(address,address,uint256)") -- topic0 for the event
 * above. Used to pre-filter a receipt's logs before attempting to decode
 * them, since a single transaction can carry logs from many contracts.
 */
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
