const fs = require('fs');
const path = 'src/server/modules/attendance.ts';
let content = fs.readFileSync(path, 'utf8');

const targetRegex = /    \/\/ Auto-end any open break at clock-out time[\s\S]*?            update: \{ amount: overtimeAmount, notes: `Overtime \$\{overtimeMinutes\}min` \},\r?\n          \}\);\r?\n        \}\r?\n      \}\r?\n    \}\r?\n/s;

const replacement = `    const overtimeSettings = await getGeneralSettings();
    const tz = overtimeSettings.timezone || 'Asia/Dhaka';
    const checkInDateYmd = formatDateYmdInTz(rec.checkInTime, tz);
    const nowYmd = formatDateYmdInTz(now, tz);
    
    let effectiveCheckout = now;
    if (checkInDateYmd !== nowYmd) {
      effectiveCheckout = endOfDayInTz(checkInDateYmd, tz);
    }

    // Auto-end any open break at check-out time
    const openBreaks = rec.breaks.filter((b) => !b.endTime);
    for (const br of openBreaks) {
      await tx.breakRecord.update({
        where: { id: br.id },
        data: {
          endTime: effectiveCheckout,
        }
      });
    }

    const mergedBreaks = rec.breaks.map((b) => (!b.endTime ? { ...b, endTime: effectiveCheckout } : b));
    const totalBreak = computeTotalBreakMinutes(mergedBreaks as any);
    const totalWorkRaw = differenceInMinutes(effectiveCheckout, rec.checkInTime) - totalBreak;
    const actualWorkRaw = totalWorkRaw > 0 ? totalWorkRaw : 0;

    // --- Overtime calculation ---
    const staffInfo2 = await tx.staffMember.findUnique({ where: { id: staffId }, select: { role: true, salaryDetails: true, paymentType: true } });
    const effectiveShift2 = await getEffectiveShift(staffId, staffInfo2?.role as string);
    const expectedMinutes = shiftExpectedMinutes(effectiveShift2);
    
    const maxOvertimeMinutes = (overtimeSettings.overtimeMaxHours > 0 ? overtimeSettings.overtimeMaxHours : 2) * 60;
    const cappedWork = Math.min(actualWorkRaw, expectedMinutes + maxOvertimeMinutes);
    const actualWork = cappedWork;
    const overtimeMinutes = Math.max(0, actualWork - expectedMinutes);

    await tx.attendanceRecord.update({
      where: { id: rec.id },
      data: {
        status: rec.status === 'Late' ? 'Late' : 'Present',
        checkOutTime: effectiveCheckout,
        totalBreakDuration: totalBreak,
        totalWorkDuration: actualWork,
        overtimeMinutes: overtimeMinutes > 0 ? overtimeMinutes : null,
      },
    });

    // Create OvertimeBonus if applicable
    if (overtimeMinutes > 0 && staffInfo2) {
      const salaryDetails = staffInfo2.salaryDetails as any;
      const amount = Number(salaryDetails?.amount ?? 0);
      const frequency = salaryDetails?.frequency as string;
      if (amount > 0 && frequency) {
        const todayKey = dateFromYmdInTz(checkInDateYmd, tz);
        let dayRate = 0;
        if (frequency === 'Monthly') {
          const dim = new Date(todayKey.getFullYear(), todayKey.getMonth() + 1, 0).getDate();
          dayRate = amount / dim;
        } else if (frequency === 'Weekly') {
          dayRate = amount / 7;
        } else if (frequency === 'Daily') {
          dayRate = amount;
        }
        if (dayRate > 0) {
          const overtimeRate = overtimeSettings.overtimeRate || 1.0;
          const overtimeAmount = Math.round((overtimeMinutes / 60) * dayRate * overtimeRate * 100) / 100;
          
          const otHours = Math.floor(overtimeMinutes / 60);
          const otMins = overtimeMinutes % 60;
          const otText = \`Overtime \${otHours}h \${otMins}m (\${overtimeMinutes}m) @ rate x\${overtimeRate}\`;

          await tx.staffIncome.upsert({
            where: { staffId_action_referenceDate: { staffId, action: 'OvertimeBonus', referenceDate: todayKey } },
            create: { staffId, action: 'OvertimeBonus', amount: overtimeAmount, referenceDate: todayKey, notes: otText },
            update: { amount: overtimeAmount, notes: otText },
          });
        }
      }
    }
`;

content = content.replace(targetRegex, replacement);
fs.writeFileSync(path, content);
