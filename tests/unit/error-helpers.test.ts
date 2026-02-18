/**
 * error-helpers.test.ts
 * Tests for error utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  getErrorMessage,
  getErrorDetails,
  formatErrorResponse,
  getErrorMessageWithFlag,
} from '../../src/utils/error-helpers.js';

describe('error-helpers', () => {
  describe('getErrorMessage', () => {
    it('should extract message from Error object', () => {
      const error = new Error('test error');
      expect(getErrorMessage(error)).toBe('test error');
    });

    it('should return string error as-is', () => {
      expect(getErrorMessage('string error')).toBe('string error');
    });

    it('should convert unknown to string', () => {
      expect(getErrorMessage(123)).toBe('123');
      expect(getErrorMessage(null)).toBe('null');
      expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('should handle objects with message property', () => {
      const error = { message: 'object error' } as any;
      expect(getErrorMessage(error)).toBe('[object Object]');
    });
  });

  describe('getErrorDetails', () => {
    it('should extract full details from Error', () => {
      const error = new Error('test error');
      const details = getErrorDetails(error);
      expect(details.message).toBe('test error');
      expect(details.name).toBe('Error');
      expect(details.type).toBe('Error');
      expect(details.stack).toBeDefined();
    });

    it('should handle string errors', () => {
      const details = getErrorDetails('string error');
      expect(details.message).toBe('string error');
      expect(details.name).toBe('StringError');
      expect(details.type).toBe('string');
    });

    it('should handle unknown types', () => {
      const details = getErrorDetails(123);
      expect(details.message).toBe('123');
      expect(details.name).toBe('Unknown');
      expect(details.type).toBe('number');
    });
  });

  describe('formatErrorResponse', () => {
    it('should format Error for API response', () => {
      const error = new Error('test error');
      const response = formatErrorResponse(error);
      expect(response.error).toBe('test error');
      expect(response.type).toBe('Error');
      expect(response.details).toBeDefined();
    });

    it('should handle string errors', () => {
      const response = formatErrorResponse('string error');
      expect(response.error).toBe('string error');
      expect(response.type).toBe('StringError');
    });
  });

  describe('getErrorMessageWithFlag', () => {
    it('should return error message', () => {
      const error = new Error('test');
      expect(getErrorMessageWithFlag(error)).toBe('test');
    });
  });
});
