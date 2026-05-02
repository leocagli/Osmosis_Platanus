// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {OffchainResolver} from "../src/ens/OffchainResolver.sol";
import {SignatureVerifier} from "../src/ens/SignatureVerifier.sol";

contract OffchainResolverTest is Test {
    OffchainResolver internal resolver;
    address internal signer;
    uint256 internal signerKey;
    address internal otherSigner;
    uint256 internal otherSignerKey;

    function setUp() public {
        (signer, signerKey) = makeAddrAndKey("ens-signer");
        (otherSigner, otherSignerKey) = makeAddrAndKey("other-signer");

        address[] memory signers = new address[](1);
        signers[0] = signer;
        resolver = new OffchainResolver("https://gateway.test/{sender}/{data}.json", signers);
    }

    function test_constructor_setsUrlAndSigner() public view {
        assertEq(resolver.url(), "https://gateway.test/{sender}/{data}.json");
        assertTrue(resolver.signers(signer));
        assertFalse(resolver.signers(otherSigner));
    }

    function test_resolve_revertsWithOffchainLookup() public {
        bytes memory name =
            hex"076d796167656e74066167656e74730c6275696c64657273636c61770365746800";
        bytes memory data = abi.encodeWithSignature("addr(bytes32)", bytes32(uint256(1)));
        vm.expectRevert();
        resolver.resolve(name, data);
    }

    function test_resolveWithProof_acceptsValidSig() public view {
        bytes memory result = abi.encode(address(0xCAFE));
        uint64 expires = uint64(block.timestamp + 60);
        bytes memory request = hex"deadbeef";

        bytes32 hash = SignatureVerifier.makeSignatureHash(address(resolver), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory response = abi.encode(result, expires, sig);

        bytes memory ret = resolver.resolveWithProof(response, request);
        assertEq(keccak256(ret), keccak256(result));
    }

    function test_resolveWithProof_rejectsExpired() public {
        bytes memory result = abi.encode(address(0xCAFE));
        uint64 expires = uint64(block.timestamp);
        vm.warp(block.timestamp + 1);
        bytes memory request = hex"deadbeef";

        bytes32 hash = SignatureVerifier.makeSignatureHash(address(resolver), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory response = abi.encode(result, expires, sig);

        vm.expectRevert("expired");
        resolver.resolveWithProof(response, request);
    }

    function test_resolveWithProof_rejectsUnknownSigner() public {
        bytes memory result = abi.encode(address(0xCAFE));
        uint64 expires = uint64(block.timestamp + 60);
        bytes memory request = hex"deadbeef";

        bytes32 hash = SignatureVerifier.makeSignatureHash(address(resolver), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherSignerKey, hash);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory response = abi.encode(result, expires, sig);

        vm.expectRevert("bad signer");
        this._callResolveWithProof(response, request);
    }

    function _callResolveWithProof(bytes memory response, bytes memory request) external view {
        resolver.resolveWithProof(response, request);
    }

    function test_addSigners_andRemove() public {
        address[] memory toAdd = new address[](1);
        toAdd[0] = otherSigner;
        resolver.addSigners(toAdd);
        assertTrue(resolver.signers(otherSigner));

        resolver.removeSigners(toAdd);
        assertFalse(resolver.signers(otherSigner));
    }

    function test_setUrl_onlyOwner() public {
        resolver.setUrl("https://new.test/{sender}/{data}.json");
        assertEq(resolver.url(), "https://new.test/{sender}/{data}.json");

        vm.prank(address(0xBEEF));
        vm.expectRevert();
        resolver.setUrl("https://hacker.test/{sender}/{data}.json");
    }

    function test_supportsInterface() public view {
        // IExtendedResolver: bytes4(keccak256("resolve(bytes,bytes)")) = 0x9061b923
        assertTrue(resolver.supportsInterface(0x9061b923));
        // IERC165
        assertTrue(resolver.supportsInterface(0x01ffc9a7));
        // Random
        assertFalse(resolver.supportsInterface(0x12345678));
    }
}
