/**
 * @author        shunzi <tobyzsj@gmail.com>
 * @date          2024-04-15 17:45:53
 */

interface StepTimeInfo {
  totalTime: number
  details: {
    key: string
    startTime: number
    time: number
  }[]
}

interface TimeInfo {
  startTime: number
  time: number
  transformTimes: number
  otherTimes: Record<string, StepTimeInfo>
}

export class Timer {
  // 记录每个文件花的事件
  static timers = new Map<string, TimeInfo>()

  constructor(private id: string) {
    const timeinfo = Timer.timers.get(this.id) || {
      startTime: 0,
      time: 0,
      transformTimes: 0,
      otherTimes: {},
    }
    Timer.timers.set(this.id, timeinfo)
  }

  startTimer() {
    const starttime = performance.now()
    const timeinfo = Timer.timers.get(this.id)!
    timeinfo.startTime = starttime
    timeinfo.transformTimes++
    Timer.timers.set(this.id, timeinfo)
  }

  endTimer() {
    const endtime = performance.now()
    const timeinfo = Timer.timers.get(this.id)!
    timeinfo.time += endtime - timeinfo.startTime
  }

  startStepTimer(type: string, key: string) {
    if (!key)
      return
    const startTime = performance.now()
    const timeinfo = Timer.timers.get(this.id)!
    let step = timeinfo.otherTimes[type]
    if (!step) {
      step = {
        totalTime: 0,
        details: [],
      }
      timeinfo.otherTimes[type] = step
    }
    step.details.push({
      key,
      startTime,
      time: 0,
    })
  }

  endStepTimer(type: string, key: string) {
    if (!key)
      return

    const endtime = performance.now()
    const timeinfo = Timer.timers.get(this.id)!
    const step = timeinfo.otherTimes[type]
    const detail = step?.details.find(item => item.key === key)
    if (!detail)
      return
    detail.time = endtime - detail.startTime
    step.totalTime += detail.time
    // if (detail.time > 10)
    //   console.log(`${type}: ${detail.time}`)
  }

  removeStepTimer(type: string, key: string) {
    const timeinfo = Timer.timers.get(this.id)!
    const step = timeinfo.otherTimes[type]
    if (!step)
      return
    step.details = step.details.filter(item => item.key !== key)
  }
}
