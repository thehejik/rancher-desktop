/**
 * This module iterates through system certificates on Windows.
 */

import _ from 'lodash';
import ffi from 'ffi-napi';
import ref from 'ref-napi';
import refStructDi from 'ref-struct-di';

import Logging from '@/utils/logging';

const console = Logging.networking;
const Struct = refStructDi(ref);

/**
 * Options for getting certificates
 */
type Options = {
    store?: CertStore[];
    encoding?: CertEncoding;
};

const DEFAULT_OPTIONS: Required<Options> = {
  store:    ['ROOT'],
  encoding: 'pem',
};

type CertStore = 'CA' | 'my' | 'ROOT' | 'spc';
type CertEncoding = 'pem';

type BOOL = ref.Type<number>;
const BOOL = ref.types.int32;

type BYTE = ref.Type<number>;
const BYTE = ref.types.byte;

type DWORD = ref.UnderlyingType<typeof ref.types.uint32>;
const DWORD = ref.types.uint32;

type LPSTR = ref.Type<string | null | ref.Value<string>>;
const LPSTR: LPSTR = ref.types.CString;

type LPCSTR = ref.UnderlyingType<typeof ref.types.CString>;
const LPCSTR = ref.types.CString;
const PBYTE = ref.refType(BYTE);

type HANDLE = ref.Pointer<unknown>;
const HANDLE: ref.Type<HANDLE> = ref.refType(ref.types.int64);
const FILETIME = Struct({
  dwLowDateTime:  DWORD,
  dwHighDateTime: DWORD,
});

type FILETIME = ref.UnderlyingType<typeof FILETIME>;
/** HCERTSTORE describes a handle to a certificate store. */
type HCERTSTORE = ref.Pointer<unknown>;
const HCERTSTORE: ref.Type<HCERTSTORE> = ref.refType(ref.types.int64);
const CRYPT_BLOB = Struct({ cbData: DWORD, pbData: PBYTE });

type CRYPT_BLOB = ref.UnderlyingType<typeof CRYPT_BLOB>;
type PCRYPT_BLOB = ref.Pointer<ref.UnderlyingType<typeof CRYPT_BLOB>>;
const PCRYPT_BLOB: ref.Type<PCRYPT_BLOB> = ref.refType(CRYPT_BLOB);
const CRYPT_ALGORITHM_IDENTIFIER = Struct({ pszObjId: LPCSTR, Parameters: CRYPT_BLOB });
/** CERT_INFO is the parsed representation of a X.509 certificate. */
const CERT_INFO = Struct({
  dwVersion:            DWORD,
  SerialNumber:         CRYPT_BLOB,
  SignatureAlgorithm:   CRYPT_ALGORITHM_IDENTIFIER,
  Issuer:               CRYPT_BLOB,
  NotBefore:            FILETIME,
  NotAfter:             FILETIME,
  Subject:              CRYPT_BLOB,
  SubjectPublicKeyInfo: Struct({
    Algorithm: CRYPT_ALGORITHM_IDENTIFIER,
    PublicKey: CRYPT_BLOB,
  }),
  IssuerUniqueId:  CRYPT_BLOB,
  SubjectUniqueId: CRYPT_BLOB,
  cExtension:      DWORD,
  rgExtension:     PBYTE,
});

type PCERT_INFO = ref.Pointer<ref.UnderlyingType<typeof CERT_INFO>>;
const PCERT_INFO: ref.Type<PCERT_INFO> = ref.refType(CERT_INFO);
/** PCCERT_CONTEXT is a pointer to a certificate context. */
const CERT_CONTEXT = Struct({
  dwCertEncodingType: DWORD,
  pbCertEncoded:      PBYTE,
  cbCertEncoded:      DWORD,
  pCertInfo:          PCERT_INFO,
  hCertStore:         HCERTSTORE,
});

type PCCERT_CONTEXT = ref.Pointer<ref.UnderlyingType<typeof CERT_CONTEXT>> | ref.Value<null>;
const PCCERT_CONTEXT: ref.Type<PCCERT_CONTEXT> = ref.refType(CERT_CONTEXT);

function isNotNull<T extends ref.Pointer<U>, U>(input: ref.Value<null> | T): input is T {
  return !input.isNull();
}

/** Return a human-readable name for a CERT_NAME_BLOB. */
function decodeCertName(encoding: DWORD, blob: CRYPT_BLOB): string {
  const stringType = 0x02000001; // CERT_SIMPLE_NAME_STR | CERT_NAME_STR_REVERSE_FLAG
  const bufSize = crypt32.CertNameToStrA(encoding, blob.ref(), stringType, null, 0);
  const buf = ref.allocCString((new Array(bufSize + 1)).join('\0'));
  const size = crypt32.CertNameToStrA(encoding, blob.ref(), stringType, buf, bufSize);
  const name = buf.subarray(0, size - 1).toString('utf-8');

  return name;
}

/** Convert a Windows FILETIME (as found in CERT_INFO) to a JS Date. */
function decodeCertTime(input: FILETIME): Date {
  // In spite of what the documentation about CERT_INFO says, the NotBefore /
  // NotAfter fields are just plain FILETIMEs (and does not involve encoding
  // based on the time range).
  // That is, it's a 64-bit integer (split into two 32-bit halves) counting
  // 100-nanosecond intervals since January 1, 1601, UTC.
  // The rounding here is acceptable as we just end up with a JS Date anyway.

  const mergedTime = input.dwHighDateTime * Math.pow(2, 32) + input.dwLowDateTime;
  const jsOffset = mergedTime / 10000 - 11644473600000;

  return new Date(jsOffset);
}

interface CertificateInfo {
    /** The certificate subject. */
    subject: string;
    /** The NotBefore validity of the certificate. */
    notBefore: Date;
    /** The NotAfter validity of the certificate. */
    notAfter: Date;
    /** The full certificate, in PEM encoding. */
    pem: string;
}

let crypt32: {
  CertOpenSystemStoreA: ffi.ForeignFunction<HCERTSTORE, [HANDLE, LPCSTR]>,
  CertCloseStore: ffi.ForeignFunction<ref.UnderlyingType<BOOL>, [HCERTSTORE, DWORD]>,
  CertEnumCertificatesInStore: ffi.ForeignFunction<PCCERT_CONTEXT, [HCERTSTORE, PCCERT_CONTEXT]>,
  CertFreeCertificateContext: ffi.ForeignFunction<ref.UnderlyingType<BOOL>, [PCCERT_CONTEXT]>,
  CertNameToStrA: ffi.ForeignFunction<DWORD, [DWORD, PCRYPT_BLOB, DWORD, ref.UnderlyingType<LPSTR>, DWORD]>,
};

function loadLibrary() {
  crypt32 ??= ffi.Library('crypt32.dll', {
    // Using the A version here to avoid string conversions; we onlyt have a
    // fix set of ASCII names anyway.
    CertOpenSystemStoreA:        [HCERTSTORE, [HANDLE, LPCSTR], { abi: ffi.FFI_WIN64 }],
    CertCloseStore:              [BOOL, [HCERTSTORE, DWORD], { abi: ffi.FFI_WIN64 }],
    CertEnumCertificatesInStore: [PCCERT_CONTEXT, [HCERTSTORE, PCCERT_CONTEXT], { abi: ffi.FFI_WIN64 }],
    CertFreeCertificateContext:  [BOOL, [PCCERT_CONTEXT], { abi: ffi.FFI_WIN64 }],
    CertNameToStrA:              [DWORD, [DWORD, PCRYPT_BLOB, DWORD, LPSTR, DWORD], { abi: ffi.FFI_WIN64 }],
  });
}

/**
 * Asynchronously enumerate PEM-encoded system certificates in undefined order.
 *
 * @note the certificates will be in Unix line endings (no carriage returns).
 */
export default async function* getCertificates(options: Options = {}): AsyncIterable<CertificateInfo> {
  try {
    const opts: Required<Options> = _.defaultsDeep({}, options, DEFAULT_OPTIONS);

    loadLibrary();

    for (const storeName of opts.store) {
      console.debug(`Enumerating certificate store ${ storeName }...`);
      const prefix = '-----BEGIN CERTIFICATE-----';
      const suffix = '-----END CERTIFICATE-----';
      const store = crypt32.CertOpenSystemStoreA(ref.NULL_POINTER, storeName);
      let pContext: PCCERT_CONTEXT = ref.NULL;

      try {
        while (true) {
          pContext = crypt32.CertEnumCertificatesInStore(store, pContext);
          if (!isNotNull(pContext)) {
            break;
          }
          const context = pContext.deref();
          const bytes = context.pbCertEncoded.reinterpret(context.cbCertEncoded, 0);
          const parts = Array.from(bytes.toString('base64').match(/.{1,63}/g) ?? []);
          const pem = `${ [prefix, ...parts, suffix].join('\n') }\n`;
          const certInfo = context.pCertInfo.deref();
          const decodedInfo = {
            subject:   decodeCertName(context.dwCertEncodingType, certInfo.Subject),
            notBefore: decodeCertTime(certInfo.NotBefore),
            notAfter:  decodeCertTime(certInfo.NotAfter),
          };

          console.debug(`Got certificate (${ context.cbCertEncoded } bytes):`, decodedInfo);
          yield { ...decodedInfo, pem };
        }
      } finally {
        if (isNotNull(pContext)) {
          crypt32.CertFreeCertificateContext(pContext);
        }
        const ok = crypt32.CertCloseStore(store, 0);

        if (!ok) {
          console.error(`Failed to close cert store ${ storeName }`);
        }
      }
    }
  } catch (ex) {
    console.error(ex);
  }
}
