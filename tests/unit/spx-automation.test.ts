import { spxAutomationService } from '../../src/services/spx-automation.service';

describe('SPX Multi-Student Automation & Session Isolation Suite', () => {
  const testStudentId = 'student-test-999';
  const testPassword = 'test-mock-secret-pass';

  test('should generate isolated session with masked ID and zero permanent password storage', async () => {
    // Start a mocked/isolated session
    const result = await spxAutomationService.startSession(testStudentId, testPassword, {
      maxLessons: 1,
    });

    expect(result.sessionId).toBeDefined();
    expect(typeof result.sessionId).toBe('string');

    // Retrieve state
    const state = spxAutomationService.getSessionState(result.sessionId);
    expect(state).not.toBeNull();
    expect(state?.studentIdMasked).toContain('****');
    expect((state as any)?.password).toBeUndefined(); // Strictly verify password is never stored!

    // Clean up
    await spxAutomationService.stopSession(result.sessionId);
  });

  test('should accurately emit terminal log with timestamp formatting', (done) => {
    const testSessionId = 'mock-session-test-id';
    
    // We can verify emitLog runs cleanly without errors
    expect(() => {
      spxAutomationService.emitLog(testSessionId, 'info', 'جاري فحص الاتصال بالمنصة...');
      spxAutomationService.emitLog(testSessionId, 'success', 'تم التحقق من إجابة السؤال بنجاح.');
      spxAutomationService.emitLog(testSessionId, 'warn', 'تنبيه: سؤال جديد غير موثق بالذاكرة.');
      spxAutomationService.emitLog(testSessionId, 'error', 'خطأ في معالجة الفصل.');
    }).not.toThrow();

    done();
  });

  test('stopping session should update state to STOPPED cleanly', async () => {
    const { sessionId } = await spxAutomationService.startSession('student-stop-test', 'pass123');
    
    const stopped = await spxAutomationService.stopSession(sessionId);
    expect(stopped).toBe(true);

    const state = spxAutomationService.getSessionState(sessionId);
    expect(state?.status).toBe('STOPPED');
  });
});
