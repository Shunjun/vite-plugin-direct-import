import { fnb } from './b'

async function importA() {
  const aa = await import('./a')
  console.log(aa.fna())
}

fnb()
importA()
