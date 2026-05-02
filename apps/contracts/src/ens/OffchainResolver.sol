// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IExtendedResolver} from "./IExtendedResolver.sol";
import {SignatureVerifier} from "./SignatureVerifier.sol";

interface IResolverService {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory result, uint64 expires, bytes memory sig);
}

/// @title CCIP-Read off-chain resolver for *.agents.buildersclaw.eth
/// @notice ENSIP-10 wildcard + EIP-3668 CCIP-Read. All resolution data is served
///         by an off-chain gateway and verified on-chain via ECDSA signature.
contract OffchainResolver is IExtendedResolver, IERC165, Ownable {
    string public url;
    mapping(address => bool) public signers;

    event NewSigners(address[] signers);
    event RemovedSigners(address[] signers);
    event NewUrl(string url);

    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    constructor(string memory _url, address[] memory _signers) Ownable(msg.sender) {
        url = _url;
        for (uint256 i = 0; i < _signers.length; i++) {
            signers[_signers[i]] = true;
        }
        emit NewUrl(_url);
        emit NewSigners(_signers);
    }

    function setUrl(string calldata _url) external onlyOwner {
        url = _url;
        emit NewUrl(_url);
    }

    function addSigners(address[] calldata _signers) external onlyOwner {
        for (uint256 i = 0; i < _signers.length; i++) {
            signers[_signers[i]] = true;
        }
        emit NewSigners(_signers);
    }

    function removeSigners(address[] calldata _signers) external onlyOwner {
        for (uint256 i = 0; i < _signers.length; i++) {
            signers[_signers[i]] = false;
        }
        emit RemovedSigners(_signers);
    }

    function makeSignatureHash(
        address target,
        uint64 expires,
        bytes memory request,
        bytes memory result
    ) external pure returns (bytes32) {
        return SignatureVerifier.makeSignatureHash(target, expires, request, result);
    }

    /// @notice ENSIP-10 entrypoint. Always reverts with OffchainLookup, telling the
    ///         caller to fetch the answer from `url` and submit it via `resolveWithProof`.
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        override
        returns (bytes memory)
    {
        bytes memory callData = abi.encodeWithSelector(IResolverService.resolve.selector, name, data);
        string[] memory urls = new string[](1);
        urls[0] = url;
        revert OffchainLookup(address(this), urls, callData, this.resolveWithProof.selector, callData);
    }

    /// @notice CCIP-Read callback. Verifies the gateway signature and returns the result.
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (bytes memory result, uint64 expires, bytes memory sig) = abi.decode(response, (bytes, uint64, bytes));
        require(expires >= block.timestamp, "expired");
        bytes32 hash = SignatureVerifier.makeSignatureHash(address(this), expires, extraData, result);
        address signer = ECDSA.recover(hash, sig);
        require(signers[signer], "bad signer");
        return result;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IExtendedResolver).interfaceId || id == type(IERC165).interfaceId;
    }
}
