export function getRandomNumbers(quantity: number, min: number, max: number): number[] {
  const result: number[] = []
  for (let counter = 0; counter < quantity; counter++) {
    // Generate a candidate until is not already included in the results
    let candidate
    do {
      candidate = Math.floor(Math.random() * (max + 1)) + min
    } while (result.includes(candidate))
    
    // Add candidate to results
    result.push(candidate)
  }
  return result
}

export function getRandomElementsFromList(list: any[], amount: number): any[] {
  const safeAmount = Math.min(amount, list.length)
  const randomPositions = getRandomNumbers(safeAmount, 0, list.length - 1)
  return randomPositions.map(pos => list[pos])
}
